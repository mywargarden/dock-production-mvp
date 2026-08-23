import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { licenseStatusFromStripe } from '../../../../lib/license';

export const runtime = 'nodejs';

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

if (!stripeSecret) {
  throw new Error('Missing STRIPE_SECRET_KEY');
}

if (!webhookSecret) {
  throw new Error('Missing STRIPE_WEBHOOK_SECRET');
}

const stripe = new Stripe(stripeSecret);

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret as string);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid Stripe webhook';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const subscription = event.data.object as Stripe.Subscription;
    const status = licenseStatusFromStripe(subscription.status);

    const { data: licenses, error } = await supabaseAdmin
      .from('dock_licenses')
      .update({
        status,
        stripe_subscription_status: subscription.status,
        stripe_customer_id: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id,
        stripe_subscription_id: subscription.id,
      })
      .eq('stripe_subscription_id', subscription.id)
      .select('*');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    for (const license of licenses || []) {
      await supabaseAdmin.from('dock_license_audit_events').insert({
        district_id: license.district_id,
        license_id: license.id,
        actor: 'stripe',
        event_type: event.type,
        payload: { stripeStatus: subscription.status, dockStatus: status },
      });
    }
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;

    if (subscriptionId) {
      const { data: licenses, error } = await supabaseAdmin
        .from('dock_licenses')
        .update({ status: 'past_due', stripe_subscription_status: 'past_due' })
        .eq('stripe_subscription_id', subscriptionId)
        .select('*');

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      for (const license of licenses || []) {
        await supabaseAdmin.from('dock_license_audit_events').insert({
          district_id: license.district_id,
          license_id: license.id,
          actor: 'stripe',
          event_type: 'invoice.payment_failed',
          payload: { subscriptionId },
        });
      }
    }
  }

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;

    if (subscriptionId) {
      const { data: licenses, error } = await supabaseAdmin
        .from('dock_licenses')
        .update({ status: 'active', stripe_subscription_status: 'active' })
        .eq('stripe_subscription_id', subscriptionId)
        .select('*');

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      for (const license of licenses || []) {
        await supabaseAdmin.from('dock_license_audit_events').insert({
          district_id: license.district_id,
          license_id: license.id,
          actor: 'stripe',
          event_type: 'invoice.payment_succeeded',
          payload: { subscriptionId },
        });
      }
    }
  }

  return NextResponse.json({ received: true });
}
