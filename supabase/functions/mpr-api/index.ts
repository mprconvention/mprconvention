import { listChangeHistory } from "./changeHistory.ts";
import { authenticate, allowed, db, reply, corsHeaders } from "../_shared/auth.ts";
import { recordAudit } from "../_shared/recordAudit.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v ? v.slice(0, max) : null;
}

function requireText(value: unknown, label: string, max = 200): string {
  const v = cleanText(value, max);
  if (!v) throw new Error(`${label} is required`);
  return v;
}

function fail(message: string, status = 400) {
  return reply({ error: message }, status);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === "object" && error !== null) {
    const e = error as Record<string, unknown>;

    if (typeof e.message === "string") return e.message;
    if (typeof e.details === "string") return e.details;
    if (typeof e.hint === "string") return e.hint;
  }

  return "Request failed";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return fail("Method not allowed", 405);
  }

  const ctx = await authenticate(req);

  if ("error" in ctx) {
    return reply({ error: ctx.error }, ctx.status ?? 401);
  }

  try {
    if (ctx.user.must_change_password) return fail("Change your password to continue", 403);
    const b = await req.json().catch(() => null);
    if (!b || typeof b !== "object" || Array.isArray(b)) return fail("Invalid request");
    const action = String(b.action ?? "");

    if (action === "list-change-history") {
      if (ctx.user.role !== "admin") return fail("Administrator access required", 403);
      return await listChangeHistory(b);
    }

    // Existing venue lookup used by calendar and booking forms.
    if (action === "get-active-venues") {
      if (
        !(
          allowed(ctx, "venues", "view") ||
          allowed(ctx, "calendar", "view") ||
          allowed(ctx, "bookings", "view") || allowed(ctx, "calendar_blocks", "view")
        )
      ) {
        return fail("Permission denied", 403);
      }

      const { data, error } = await db.rpc("mpr_active_venues", { p_actor: ctx.user.id });
      if (error) throw error;
      return reply({ data });
    }

    if (action === "get-lov-values") {
      const code = String(b.list_code ?? "");
      const modules: Record<string, string[]> = {
        entry_statuses: ["bookings", "calendar_blocks"], booking_modes: ["bookings", "calendar_blocks"],
        event_types: ["bookings"], booking_sources: ["bookings"], block_reasons: ["calendar_blocks"],
        customer_categories: ["customers"], venue_types: ["venues"],
        auspicious_categories: ["auspicious_dates"], regions: ["auspicious_dates"],
      };
      if (ctx.user.role !== "admin" && !Object.hasOwn(modules, code)) return fail("Permission denied", 403);
      if (ctx.user.role !== "admin" && !modules[code].some(module =>
        ["view", "create", "edit"].some(operation => allowed(ctx, module, operation)))) {
        return fail("Permission denied", 403);
      }

      const { data: list, error: le } = await db.from("lov_lists")
        .select("id")
        .eq("list_code", code)
        .eq("is_active", true)
        .maybeSingle();

      if (le) throw le;
      if (!list) return reply({ data: [] });

      const lookup = db.from("lov_values")
        .select("value_code,display_label,description,extra_data,sort_order,is_active")
        .eq("list_id", list.id);
      const includeInactive = b.include_inactive === true && [
        "entry_statuses", "booking_modes", "event_types", "booking_sources", "block_reasons",
        "customer_categories", "venue_types", "auspicious_categories", "regions",
      ].includes(code);
      const { data, error } = await (includeInactive ? lookup : lookup.eq("is_active", true))
        .order("sort_order")
        .order("display_label");

      if (error) throw error;
      return reply({ data: data ?? [] });
    }

    if (action === "get-availability" || action === "get-three-calendars") {
      if (!allowed(ctx, "calendar", "view")) return fail("Calendar permission required", 403);
      const venueId = String(b.venue_id ?? "");
      const month = String(b.month ?? "");
      if (!UUID.test(venueId) || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)) {
        return fail("Invalid venue or month");
      }
      const [year, monthNumber] = month.split("-").map(Number);
      const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
      const { data, error } = await db.rpc("mpr_availability", {
        p_actor: ctx.user.id, p_venue: venueId,
        p_start: `${month}-01`, p_end: `${month}-${lastDay}`,
      });
      if (error) throw error;
      if (action === "get-three-calendars") {
        return reply({
          reserved: data.entries.filter((entry: { entry_type: string }) => entry.entry_type === "reserved"),
          blocked: data.entries.filter((entry: { entry_type: string }) => entry.entry_type === "blocked"),
          auspicious: data.auspicious,
        });
      }
      return reply(data);
    }

    if (action === "get-dashboard-counts") {
      if (!allowed(ctx, "dashboard", "view")) return fail("Dashboard permission required", 403);
      const { data, error } = await db.rpc("mpr_dashboard_counts", { p_actor: ctx.user.id });
      if (error) throw error;
      return reply({ data });
    }

    // LOV administration.
    if (action === "list-lov-lists") {
      if (ctx.user.role !== "admin") {
        return fail("Administrator access required", 403);
      }

      const { data, error } = await db.from("lov_lists")
        .select(`id,list_code,list_name,description,${recordAudit("lov_lists")}`)
        .eq("is_active", true)
        .order("sort_order")
        .order("list_name");

      if (error) throw error;
      return reply({ data: data ?? [] });
    }

    if (action === "create-lov-list" || action === "update-lov-list") {
      if (ctx.user.role !== "admin") return fail("Administrator access required", 403);

      const payload = {
        list_name: requireText(b.list_name, "List name"),
        description: cleanText(b.description),
        updated_by: ctx.user.id,
      };
      const listId = String(b.id ?? "");
      const code = String(b.list_code ?? "").trim();
      const isEdit = action === "update-lov-list";
      if (isEdit ? !UUID.test(listId) : !/^[a-z][a-z0-9_]{1,62}$/.test(code)) {
        return fail(isEdit ? "Valid list is required" : "Invalid list code");
      }

      const query = isEdit
        ? db.from("lov_lists").update(payload).eq("id", listId)
        : db.from("lov_lists").insert({ ...payload, list_code: code, created_by: ctx.user.id });
      const { data, error } = await query.select("id").single();
      if (error) throw error;
      return reply({ data }, isEdit ? 200 : 201);
    }

    if (action === "list-lov-values") {
      if (ctx.user.role !== "admin") {
        return fail("Administrator access required", 403);
      }

      const listId = String(b.list_id ?? "");
      if (!UUID.test(listId)) return fail("Valid list is required");

      const { data, error } = await db.from("lov_values")
        .select(`id,value_code,display_label,description,sort_order,is_active,is_default,extra_data,${recordAudit("lov_values", "_mpr_fk")}`)
        .eq("list_id", listId)
        .order("sort_order")
        .order("display_label");

      if (error) throw error;
      return reply({ data: data ?? [] });
    }

    if (action === "add-lov-value") {
      if (ctx.user.role !== "admin") {
        return fail("Administrator access required", 403);
      }

      const listId = String(b.list_id ?? "");
      const code = String(b.value_code ?? "");
      const label = requireText(b.display_label, "Display label");

      if (
        !UUID.test(listId) ||
        !/^[a-z][a-z0-9_]{0,62}$/.test(code)
      ) {
        return fail("Invalid list or value code");
      }

      const sortOrder = b.sort_order ?? 0;
      if (!Number.isInteger(sortOrder)) return fail("Sort order must be an integer");

      const { data, error } = await db.from("lov_values").insert({
        list_id: listId,
        value_code: code,
        display_label: label,
        description: cleanText(b.description),
        sort_order: sortOrder,
        extra_data: typeof b.behavior === "string" ? { behavior: b.behavior } : {},
        is_active: true,
        created_by: ctx.user.id,
        updated_by: ctx.user.id
      })
        .select("id")
        .single();

      if (error) throw error;
      return reply({ data });
    }

    if (action === "update-lov-value") {
      if (ctx.user.role !== "admin") {
        return fail("Administrator access required", 403);
      }

      const id = String(b.id ?? "");
      if (!UUID.test(id)) return fail("Invalid value ID");

      const patch: Record<string, unknown> = {
        updated_by: ctx.user.id
      };

      if (typeof b.display_label === "string") {
        patch.display_label = requireText(
          b.display_label,
          "Display label"
        );
      }

      if (typeof b.description === "string" || b.description === null) {
        patch.description = cleanText(b.description);
      }

      if (typeof b.is_active === "boolean") {
        patch.is_active = b.is_active;
      }

      if (Number.isInteger(b.sort_order)) {
        patch.sort_order = b.sort_order;
      }

      const { error } = await db.from("lov_values")
        .update(patch)
        .eq("id", id);

      if (error) throw error;
      return reply({ ok: true });
    }

    const recordModule = action === "list-customers" ? "customers"
      : action === "list-venues" ? "venues"
      : action === "list-auspicious-dates" ? "auspicious_dates" : null;
    if (recordModule) {
      if (!allowed(ctx, recordModule, "view")) return fail("Record view permission required", 403);
      const page = b.page ?? 0;
      if (!Number.isSafeInteger(page) || page < 0 || page > 85_899_345) return fail("Invalid page");
      const { data, error } = await db.rpc("mpr_search_records", {
        p_actor: ctx.user.id, p_module: recordModule, p_page: page, p_query: cleanText(b.query, 150) ?? "",
      });
      if (error) throw error;
      return reply(data);
    }

    // Customers.
    if (action === "save-customer") {
      const id = b.id ? String(b.id) : "";
      const isEdit = Boolean(id);

      if (
        isEdit
          ? !allowed(ctx, "customers", "edit")
          : !allowed(ctx, "customers", "create")
      ) {
        return fail("Customers permission denied", 403);
      }

      if (isEdit && !UUID.test(id)) {
        return fail("Invalid customer ID");
      }

      const payload = {
        customer_name: requireText(b.customer_name, "Customer name"),
        mobile: cleanText(b.mobile, 40),
        email: cleanText(b.email, 254),
        address: cleanText(b.address, 1000),
        city: cleanText(b.city, 120),
        customer_category_code: cleanText(b.customer_category_code, 80),
        notes: cleanText(b.notes, 2000),
        updated_by: ctx.user.id
      };

      const query = isEdit
        ? db.from("customers").update(payload).eq("id", id)
        : db.from("customers").insert({
            ...payload,
            created_by: ctx.user.id
          });

      const { data, error } = await query.select("id").single();

      if (error) throw error;
      return reply({ data });
    }

    if (action === "delete-customer") {
      if (!allowed(ctx, "customers", "delete")) {
        return fail("Customers delete permission required", 403);
      }

      const id = String(b.id ?? "");
      if (!UUID.test(id)) return fail("Invalid customer ID");

      const { count, error: countError } = await db.from("calendar_entries")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", id)
        .eq("entry_type", "reserved");

      if (countError) throw countError;

      if ((count ?? 0) > 0) {
        return fail(
          "This customer is linked to bookings and cannot be deleted.",
          409
        );
      }

      const { error } = await db.rpc("mpr_delete_customer", { p_id: id, p_actor_id: ctx.user.id });

      if (error) throw error;
      return reply({ ok: true });
    }

    // Venues: soft deactivation preserves booking history.
    if (action === "save-venue") {
      const id = b.id ? String(b.id) : "";
      const isEdit = Boolean(id);

      if (
        isEdit
          ? !allowed(ctx, "venues", "edit")
          : !allowed(ctx, "venues", "create")
      ) {
        return fail("Venues permission denied", 403);
      }

      if (isEdit && !UUID.test(id)) {
        return fail("Invalid venue ID");
      }

      const payload = {
        venue_name: requireText(b.venue_name, "Venue name"),
        venue_code: cleanText(b.venue_code, 80),
        venue_type_code: cleanText(b.venue_type_code, 80),
        address: cleanText(b.address, 1000),
        city: cleanText(b.city, 120),
        timezone: requireText(
          b.timezone ?? "Asia/Kolkata",
          "Timezone",
          100
        ),
        updated_by: ctx.user.id
      };

      const query = isEdit
        ? db.from("venues").update(payload).eq("id", id)
        : db.from("venues").insert({
            ...payload,
            created_by: ctx.user.id,
            is_active: true
          });

      const { data, error } = await query.select("id").single();

      if (error) throw error;
      return reply({ data });
    }

    if (action === "deactivate-venue") {
      if (!allowed(ctx, "venues", "delete")) {
        return fail("Venues delete permission required", 403);
      }

      const id = String(b.id ?? "");
      if (!UUID.test(id)) return fail("Invalid venue ID");

      const { error } = await db.from("venues")
        .update({
          is_active: false,
          updated_by: ctx.user.id
        })
        .eq("id", id);

      if (error) throw error;
      return reply({ ok: true });
    }

    // Auspicious dates: deactivation retains historical references.
    if (action === "save-auspicious-date") {
      const id = b.id ? String(b.id) : "";
      const isEdit = Boolean(id);

      if (
        isEdit
          ? !allowed(ctx, "auspicious_dates", "edit")
          : !allowed(ctx, "auspicious_dates", "create")
      ) {
        return fail("Auspicious dates permission denied", 403);
      }

      if (isEdit && !UUID.test(id)) {
        return fail("Invalid auspicious date ID");
      }

      const date = String(b.date ?? "");

      if (
        !datePattern.test(date) ||
        Number.isNaN(Date.parse(`${date}T00:00:00Z`))
      ) {
        return fail("A valid date is required");
      }

      const payload = {
        date,
        title: requireText(b.title, "Title"),
        category_code: cleanText(b.category_code, 80),
        description: cleanText(b.description, 2000),
        region_code: cleanText(b.region_code, 80),
        source: cleanText(b.source, 500),
        updated_by: ctx.user.id
      };

      const query = isEdit
        ? db.from("auspicious_dates").update(payload).eq("id", id)
        : db.from("auspicious_dates").insert({
            ...payload,
            is_active: true,
            created_by: ctx.user.id
          });

      const { data, error } = await query.select("id").single();

      if (error) throw error;
      return reply({ data });
    }

    if (action === "deactivate-auspicious-date") {
      if (!allowed(ctx, "auspicious_dates", "delete")) {
        return fail("Auspicious dates delete permission required", 403);
      }

      const id = String(b.id ?? "");
      if (!UUID.test(id)) return fail("Invalid auspicious date ID");

      const { error } = await db.from("auspicious_dates")
        .update({
          is_active: false,
          updated_by: ctx.user.id
        })
        .eq("id", id);

      if (error) throw error;
      return reply({ ok: true });
    }

    if (action === "list-booking-workflow" || action === "save-booking-workflow") {
      const booking = b.booking_id ?? null;
      if (booking !== null && (typeof booking !== "string" || !UUID.test(booking))) return fail("Invalid booking ID");
      const kinds = ["inquiry", "quote", "deposit", "reminder", "instructions"];
      const kind = b.kind ?? null;
      if (kind !== null && !kinds.includes(kind)) return fail("Select a workflow item type");
      if (action === "list-booking-workflow") {
        if (!allowed(ctx, "booking_workflow", "view")) return fail("Booking workflow view permission required", 403);
        const page = b.page ?? 0;
        if (!Number.isSafeInteger(page) || page < 0) return fail("Invalid page");
        const { data, error } = await db.rpc("mpr_list_booking_workflow", {
          p_actor: ctx.user.id, p_booking: booking, p_kind: kind,
          p_query: cleanText(b.query, 150) ?? "", p_page: page,
        });
        if (error) throw error;
        return reply(data);
      }
      const id = b.id ?? null;
      if (id !== null && (typeof id !== "string" || !UUID.test(id))) return fail("Invalid workflow record ID");
      if (!allowed(ctx, "booking_workflow", id ? "edit" : "create")) return fail("Booking workflow permission required", 403);
      if (!kind) return fail("Select a workflow item type");
      const amount = b.amount ?? null;
      if (amount !== null && (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount >= 1e12)) {
        return fail("Enter a valid amount");
      }
      const { data, error } = await db.rpc("mpr_save_booking_workflow", {
        p_actor: ctx.user.id, p_id: id,
        p_record: {
          booking_id: booking, kind, title: requireText(b.title, "Title"), status: requireText(b.status, "Status", 30),
          amount, due_at: cleanText(b.due_at, 40), notes: cleanText(b.notes, 4000), updated_at: cleanText(b.updated_at, 40),
        },
      });
      if (error) throw error;
      return reply({ data: { id: data } }, id ? 200 : 201);
    }

    // Booking workspace: reservations and blocked periods.
    if (action === "list-bookings") {
      if (!allowed(ctx, "bookings", "view") && !allowed(ctx, "calendar_blocks", "view")) {
        return fail("Bookings or calendar blocks view permission required", 403);
      }
      const page = b.page ?? 0;
      if (!Number.isSafeInteger(page) || page < 0 || page > 85_899_345) return fail("Invalid page");
      const { data, error } = await db.rpc("mpr_search_bookings", {
        p_actor: ctx.user.id, p_page: page, p_query: cleanText(b.query, 150) ?? "",
      });
      if (error) throw error;
      return reply(data);
    }

    if (action === "list-booking-customers") {
      if (!allowed(ctx, "bookings", "create") && !allowed(ctx, "bookings", "edit")) {
        return fail("Booking write permission required", 403);
      }
      const { data, error } = await db.rpc("mpr_booking_customer_lookup", {
        p_actor: ctx.user.id, p_query: cleanText(b.query, 150) ?? "",
      });
      if (error) throw error;
      return reply({ data });
    }

    if (action === "save-booking") {
      const id = b.id ? String(b.id) : null;
      if (id && !UUID.test(id)) {
        return fail("Invalid booking ID");
      }

      const entryStatus = String(b.booking_status ?? "");
      const isBlocked = entryStatus === "blocked";
      if (!allowed(ctx, isBlocked ? "calendar_blocks" : "bookings", id ? "edit" : "create")) {
        return fail("Booking permission denied", 403);
      }
      if (id && (!Number.isSafeInteger(b.revision) || b.revision < 1)) {
        return fail("Refresh and reopen this entry before saving.", 409);
      }
      if (b.hold_minutes != null && ![30, 60, 240, 1440].includes(b.hold_minutes)) {
        return fail("Invalid hold duration");
      }

      if (!["pending", "confirmed", "blocked"].includes(entryStatus)) {
        return fail("Invalid entry status");
      }

      const venueId = String(b.venue_id ?? "");
      if (!UUID.test(venueId)) {
        return fail("Valid venue is required");
      }

      const customerId = isBlocked
        ? null
        : String(b.customer_id ?? "");

      if (!isBlocked && !UUID.test(customerId ?? "")) {
        return fail("Customer is required for reservations");
      }

      const startDate = String(b.start_date ?? "");
      const endDate = String(b.end_date ?? "");

      if (
        !datePattern.test(startDate) ||
        !datePattern.test(endDate)
      ) {
        return fail("Valid start and end dates are required");
      }

      const blockReason = isBlocked
        ? requireText(b.block_reason_code, "Block reason", 100)
        : null;

      const payload = {
        venue_id: venueId,
        revision: b.revision,
        hold_minutes: b.hold_minutes,
        customer_id: customerId,
        event_name: requireText(
          b.event_name,
          "Event or block name",
          200
        ),
        event_type_code: isBlocked ? null : cleanText(b.event_type_code, 80),
        booking_source_code: isBlocked ? null : cleanText(b.booking_source_code, 80),
        booking_mode: b.booking_mode,
        entry_status_code: cleanText(b.entry_status_code, 63),
        booking_mode_code: cleanText(b.booking_mode_code, 63),
        booking_status: isBlocked ? null : entryStatus,
        entry_type: isBlocked ? "blocked" : "reserved",
        block_reason_code: blockReason,
        start_date: startDate,
        end_date: endDate,
        start_time: b.booking_mode === "time_slot"
          ? b.start_time
          : null,
        end_time: b.booking_mode === "time_slot"
          ? b.end_time
          : null,
        notes: cleanText(b.notes, 2000)
      };

      const { data, error } = await db.rpc("mpr_save_booking", {
        p_actor_id: ctx.user.id,
        p_booking_id: id,
        p_payload: payload
      });

      if (error) throw error;
      return reply({ data: { id: data } });
    }

    if (action === "cancel-booking") {
      if (!allowed(ctx, "bookings", "delete") && !allowed(ctx, "calendar_blocks", "delete")) {
        return fail("Booking cancellation permission required", 403);
      }
      const id = String(b.id ?? "");
      if (!UUID.test(id)) return fail("Invalid calendar entry ID");
      if (!Number.isSafeInteger(b.revision) || b.revision < 1) {
        return fail("Refresh and reopen this entry before cancelling.", 409);
      }
      const { error } = await db.rpc("mpr_cancel_booking", {
        p_actor: ctx.user.id, p_id: id, p_revision: b.revision,
      });
      if (error) throw error;
      return reply({ ok: true });
    }

    return fail("Unknown action");

  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (code === "23P01") return fail("This venue is already occupied for part of that period.", 409);
    if (code === "23503") return fail("This record is linked to another record or no longer exists.", 409);
    if (code === "40P01" || code === "40001") return fail("Another change was saved at the same time. Refresh and try again.", 409);
    if (code === "P4090") return fail(getErrorMessage(error), 409);
    if (code === "42501") return fail(getErrorMessage(error), 403);
    if (code === "P0002" || code === "PGRST116") return fail("Record not found", 404);
    if (code === "23505") return fail("A record with that code or name already exists.", 409);
    if (error instanceof Error || ["P0001", "23514", "22023", "22P02", "22007", "22008"].includes(String(code))) {
      return fail(getErrorMessage(error));
    }
    console.error("MPR API error", code);
    return fail("Unable to complete the request", 500);
  }
});
