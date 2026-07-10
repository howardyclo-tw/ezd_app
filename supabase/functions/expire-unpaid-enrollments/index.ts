import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: overdue, error: fetchErr } = await supabase
    .from("enrollments")
    .select("id, course_id, order_id, user_id")
    .eq("status", "pending_payment")
    .not("payment_deadline_at", "is", null)
    .lt("payment_deadline_at", new Date().toISOString());

  if (fetchErr) {
    return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 });
  }

  if (!overdue || overdue.length === 0) {
    return new Response(JSON.stringify({ expired: 0 }), { status: 200 });
  }

  let expired = 0;
  const errors: string[] = [];

  for (const enrollment of overdue) {
    const { error: cancelErr } = await supabase
      .from("enrollments")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "繳費逾期自動取消" })
      .eq("id", enrollment.id)
      .eq("status", "pending_payment");

    if (cancelErr) {
      errors.push(`enrollment ${enrollment.id}: ${cancelErr.message}`);
      continue;
    }

    if (enrollment.order_id) {
      const { data: siblings } = await supabase
        .from("enrollments")
        .select("id, status")
        .eq("order_id", enrollment.order_id);

      const allCancelled = siblings?.every((s) => s.status === "cancelled");
      if (allCancelled) {
        await supabase
          .from("orders")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .eq("id", enrollment.order_id)
          .eq("status", "pending");
      }
    }

    const { data: course } = await supabase
      .from("courses")
      .select("waitlist_enabled")
      .eq("id", enrollment.course_id)
      .single();

    if (course?.waitlist_enabled) {
      await supabase.rpc("promote_from_waitlist", { p_course_id: enrollment.course_id });
    }

    expired++;
  }

  return new Response(
    JSON.stringify({ expired, errors: errors.length > 0 ? errors : undefined }),
    { status: 200 }
  );
});
