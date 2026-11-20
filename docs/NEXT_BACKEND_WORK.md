# Optional booking workflows

- Multi-space and nonconsecutive reservations can build on the allocation table. Introduce an allocation ID and save all requested allocations in the same transaction when these workflows are enabled. The current booking form saves one contiguous interval.
- Inquiries, quotes, deposit records, in-app reminders and event-day instructions are optional. A team member can book, confirm or cancel a reservation without those steps. The workflow tracks payment status and reminder timing. Payment processing and outbound reminder delivery are separate integrations.
- Customer self-service can follow hosted staging verification of availability, booking transitions and customer-specific access.
