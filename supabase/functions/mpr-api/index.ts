
import { authenticate, allowed, db, reply, corsHeaders } from "../_shared/auth.ts";

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
    return reply({ error: ctx.error }, 401);
  }

  try {
    const b = await req.json();
    const action = String(b.action ?? "");

    // Existing venue lookup used by calendar and booking forms.
    if (action === "get-active-venues") {
      if (
        !(
          allowed(ctx, "venues", "view") ||
          allowed(ctx, "calendar", "view") ||
          allowed(ctx, "bookings", "view")
        )
      ) {
        return fail("Permission denied", 403);
      }

      const { data, error } = await db.from("venues")
        .select("id,venue_name,venue_code,timezone")
        .eq("is_active", true)
        .order("venue_name");

      if (error) throw error;
      return reply({ data: data ?? [] });
    }

    if (action === "get-lov-values") {
      const code = String(b.list_code ?? "");

      const { data: list, error: le } = await db.from("lov_lists")
        .select("id")
        .eq("list_code", code)
        .eq("is_active", true)
        .maybeSingle();

      if (le) throw le;
      if (!list) return reply({ data: [] });

      const { data, error } = await db.from("lov_values")
        .select("value_code,display_label,description,extra_data,sort_order")
        .eq("list_id", list.id)
        .eq("is_active", true)
        .order("sort_order");

      if (error) throw error;
      return reply({ data: data ?? [] });
    }

    // Three calendar data sets.
    if (action === "get-three-calendars") {
      const venueId = String(b.venue_id ?? "");
      const month = String(b.month ?? "");

      if (!UUID.test(venueId) || !/^\d{4}-\d{2}$/.test(month)) {
        return fail("Invalid venue or month");
      }

      if (!allowed(ctx, "calendar", "view")) {
        return fail("Calendar permission required", 403);
      }

      const [y, m] = month.split("-").map(Number);
      const start = `${month}-01`;
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const end = `${month}-${String(last).padStart(2, "0")}`;

      const [reserved, blocked, auspicious] = await Promise.all([
        db.from("calendar_entries")
          .select("*")
          .eq("venue_id", venueId)
          .eq("entry_type", "reserved")
          .eq("status", "active")
          .lte("start_date", end)
          .gte("end_date", start)
          .order("starts_at"),

        db.from("calendar_entries")
          .select("*")
          .eq("venue_id", venueId)
          .eq("entry_type", "blocked")
          .eq("status", "active")
          .lte("start_date", end)
          .gte("end_date", start)
          .order("starts_at"),

        db.from("auspicious_dates")
          .select("id,date,title,category_code,description,region_code")
          .eq("is_active", true)
          .gte("date", start)
          .lte("date", end)
          .order("date")
      ]);

      if (reserved.error) throw reserved.error;
      if (blocked.error) throw blocked.error;
      if (auspicious.error) throw auspicious.error;

      return reply({
        reserved: reserved.data ?? [],
        blocked: blocked.data ?? [],
        auspicious: allowed(ctx, "auspicious_dates", "view")
          ? (auspicious.data ?? [])
          : []
      });
    }

    // LOV administration.
    if (action === "list-lov-lists") {
      if (ctx.user.role !== "admin") {
        return fail("Administrator access required", 403);
      }

      const { data, error } = await db.from("lov_lists")
        .select("id,list_code,list_name,description")
        .eq("is_active", true)
        .order("sort_order")
        .order("list_name");

      if (error) throw error;
      return reply({ data: data ?? [] });
    }

    if (action === "list-lov-values") {
      if (ctx.user.role !== "admin") {
        return fail("Administrator access required", 403);
      }

      const listId = String(b.list_id ?? "");
      if (!UUID.test(listId)) return fail("Valid list is required");

      const { data, error } = await db.from("lov_values")
        .select("id,value_code,display_label,description,sort_order,is_active,is_default")
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

      const { data, error } = await db.from("lov_values").insert({
        list_id: listId,
        value_code: code,
        display_label: label,
        description: cleanText(b.description),
        sort_order: Number(b.sort_order ?? 0),
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

    // Customers.
    if (action === "list-customers") {
      if (!allowed(ctx, "customers", "view")) {
        return fail("Customers view permission required", 403);
      }

      const { data, error } = await db.from("customers")
        .select("id,customer_name,mobile,email,address,city,customer_category_code,notes,created_at,updated_at")
        .order("customer_name");

      if (error) throw error;
      return reply({ data: data ?? [] });
    }

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
        updated_by: ctx.user.id,
        updated_at: new Date().toISOString()
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

      const { error } = await db.from("customers")
        .delete()
        .eq("id", id);

      if (error) throw error;
      return reply({ ok: true });
    }

    // Venues: soft deactivation preserves booking history.
    if (action === "list-venues") {
      if (!allowed(ctx, "venues", "view")) {
        return fail("Venues view permission required", 403);
      }

      const { data, error } = await db.from("venues")
        .select("id,venue_name,venue_code,venue_type_code,address,city,timezone,is_active,created_at,updated_at")
        .order("venue_name");

      if (error) throw error;
      return reply({ data: data ?? [] });
    }

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
        updated_at: new Date().toISOString()
      };

      const query = isEdit
        ? db.from("venues").update(payload).eq("id", id)
        : db.from("venues").insert({
            ...payload,
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
          updated_at: new Date().toISOString()
        })
        .eq("id", id);

      if (error) throw error;
      return reply({ ok: true });
    }

    // Auspicious dates: deactivation retains historical references.
    if (action === "list-auspicious-dates") {
      if (!allowed(ctx, "auspicious_dates", "view")) {
        return fail("Auspicious dates view permission required", 403);
      }

      const { data, error } = await db.from("auspicious_dates")
        .select("id,date,title,category_code,description,region_code,source,is_active,created_at,updated_at")
        .order("date", { ascending: false });

      if (error) throw error;
      return reply({ data: data ?? [] });
    }

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
        updated_by: ctx.user.id,
        updated_at: new Date().toISOString()
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
          updated_by: ctx.user.id,
          updated_at: new Date().toISOString()
        })
        .eq("id", id);

      if (error) throw error;
      return reply({ ok: true });
    }

    // Booking workspace: reservations and blocked periods.
    if (action === "list-bookings") {
      if (!allowed(ctx, "bookings", "view")) {
        return fail("Bookings view permission required", 403);
      }

      const { data, error } = await db.from("calendar_entries")
        .select(`
          id,venue_id,customer_id,event_name,event_type_code,
          booking_source_code,entry_type,booking_mode,start_date,
          end_date,start_time,end_time,booking_status,
          block_reason_code,status,notes,timezone,starts_at,ends_at
        `)
        .in("entry_type", ["reserved", "blocked"])
        .order("starts_at", { ascending: false });

      if (error) throw error;
      return reply({ data: data ?? [] });
    }

    if (action === "list-booking-customers") {
      if (!allowed(ctx, "bookings", "view")) {
        return fail("Bookings view permission required", 403);
      }

      const { data, error } = await db.from("customers")
        .select("id,customer_name,mobile,email")
        .order("customer_name");

      if (error) throw error;
      return reply({ data: data ?? [] });
    }

    if (action === "save-booking") {
      const id = b.id ? String(b.id) : null;
      const isEdit = Boolean(id);

      if (
        isEdit
          ? !allowed(ctx, "bookings", "edit")
          : !allowed(ctx, "bookings", "create")
      ) {
        return fail("Bookings permission denied", 403);
      }

      if (id && !UUID.test(id)) {
        return fail("Invalid booking ID");
      }

      const entryStatus = String(b.booking_status ?? "");
      const isBlocked = entryStatus === "blocked";

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
        customer_id: customerId,
        event_name: requireText(
          b.event_name,
          "Event or block name",
          200
        ),
        event_type_code: cleanText(b.event_type_code, 80),
        booking_source_code: cleanText(b.booking_source_code, 80),
        booking_mode: b.booking_mode,
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
      if (!allowed(ctx, "bookings", "delete")) {
        return fail("Bookings delete permission required", 403);
      }

      const id = String(b.id ?? "");
      if (!UUID.test(id)) {
        return fail("Invalid calendar entry ID");
      }

      const { data, error } = await db.from("calendar_entries")
        .update({
          status: "cancelled",
          updated_by: ctx.user.id,
          updated_at: new Date().toISOString()
        })
        .eq("id", id)
        .in("entry_type", ["reserved", "blocked"])
        .eq("status", "active")
        .select("id")
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return fail("Active calendar entry not found", 404);
      }

      return reply({ ok: true });
    }

    return fail("Unknown action");

  } catch (error) {
    console.error("MPR API error:", error);

    const message = getErrorMessage(error);
    return fail(message);
  }
});
