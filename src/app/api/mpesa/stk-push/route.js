import { NextResponse } from 'next/server';

// ─── PayHero API configuration (hardcoded) ───────────────────────────────
const PAYHERO_API_URL = 'https://backend.payhero.co.ke/api/v2/payments';
const PAYHERO_API_USERNAME = 'qI4IBCqJqR3mNGM9nqND';
const PAYHERO_API_PASSWORD = 'GvWNypdtFlm8pVP4KXK2DdxIb0SUDrxtrtdrXnvP';
const PAYHERO_CHANNEL_ID = '10900';
const PAYHERO_CALLBACK_URL = 'https://yourdomain.com/api/payhero/callback';
const BASIC_AUTH_TOKEN = 'Basic cUk0SUJDcUpxUjNtTkdNOW5xTkQ6R3ZXTnlwZHRGbG04cFZQNEtYSzJEZHhJYjBTVURyeHRydGRyWG52UA==';
// ──────────────────────────────────────────────────────────────────────────

function normalizePhone(phone) {
  let digits = phone.replace(/\D/g, '');
  while (digits.startsWith('0')) {
    digits = digits.substring(1);
  }
  if (digits.startsWith('254')) return digits;
  if (digits.length === 9 && (digits.startsWith('7') || digits.startsWith('1'))) return '254' + digits;
  if (!digits.startsWith('254') && digits.length > 0) return '254' + digits;
  return digits;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { phoneNumber, amount, transactionType, accountReference } = body;

    console.log('[CashJet STK] Initiating STK Push:', { phone: phoneNumber, amount, type: transactionType });

    if (!phoneNumber || !amount || amount <= 0) {
      return NextResponse.json({ success: false, message: 'Invalid phone number or amount' }, { status: 400 });
    }

    if (!PAYHERO_CHANNEL_ID || (!BASIC_AUTH_TOKEN && (!PAYHERO_API_USERNAME || !PAYHERO_API_PASSWORD))) {
      console.error('[CashJet STK] Missing PayHero configuration values');
      return NextResponse.json(
        { success: false, message: 'Payment gateway configuration is missing on the server.' },
        { status: 500 }
      );
    }

    const phone = normalizePhone(phoneNumber);
    if (!/^254[17][0-9]{8}$/.test(phone)) {
      return NextResponse.json(
        { success: false, message: 'Invalid Kenyan phone number format. Use 07XXXXXXXX or 01XXXXXXXX.' },
        { status: 400 }
      );
    }

    let authHeader = BASIC_AUTH_TOKEN;
    if (!authHeader && PAYHERO_API_USERNAME && PAYHERO_API_PASSWORD) {
      authHeader = 'Basic ' + Buffer.from(`${PAYHERO_API_USERNAME}:${PAYHERO_API_PASSWORD}`).toString('base64');
    }

    const payload = {
      amount: Math.round(parseFloat(amount)),
      phone_number: phone,
      channel_id: /^\d+$/.test(PAYHERO_CHANNEL_ID) ? parseInt(PAYHERO_CHANNEL_ID, 10) : PAYHERO_CHANNEL_ID,
      provider: 'm-pesa',
      external_reference: accountReference || `DEP-${Date.now()}`,
      callback_url: PAYHERO_CALLBACK_URL,
      description: transactionType === 'deposit' ? 'CashJet Deposit' : 'CashJet Withdrawal'
    };

    console.log('[CashJet STK] Sending PayHero payload:', { ...payload, phone_number: '***' });

    const response = await fetch(PAYHERO_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000)
    });

    console.log('[CashJet STK] PayHero response status:', response.status);

    // Safe parse: never assume the body is JSON
    const rawBody = await response.text();
    let data = {};
    try {
      data = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      data = { rawBody: rawBody.slice(0, 500), note: 'PayHero returned a non-JSON response' };
    }
    console.log('[CashJet STK] PayHero response body:', rawBody.slice(0, 1000));

    if (response.ok && data.success !== false) {
      const checkoutRequestId = data.CheckoutRequestID || data.checkoutRequestId || `ws_CO_${Date.now()}`;
      const merchantRequestId = data.MerchantRequestID || data.merchantRequestId || '';

      return NextResponse.json({
        success: true,
        checkoutRequestId,
        merchantRequestId,
        message: data.CustomerMessage || data.ResponseDescription || data.message || `STK push sent to ${phone}`,
      });
    } else {
      console.error('[CashJet STK] PayHero API Error:', data);
      return NextResponse.json(
        {
          success: false,
          message: data.message || data.ResponseDescription || data.error || `PayHero responded with HTTP ${response.status}`,
          detail: data
        },
        { status: response.status || 400 }
      );
    }
  } catch (error) {
    console.error('[CashJet STK] Exception in STK Push:', error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'Server error processing payment request' },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS,PATCH,DELETE,POST,PUT',
      'Access-Control-Allow-Headers': 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization',
    },
  });
}
