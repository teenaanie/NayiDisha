/**
 * PayoutProvider (§13, §24.2)
 *
 * The internal reward ledger is the source of truth; a payment provider is an
 * execution channel, never the system of record. This adapter simulates the
 * RazorpayX/Cashfree payout call and its webhook confirmation so the finance
 * console can be exercised without a payment-provider account, KYC approval or
 * a rupee moving anywhere.
 */
export interface PayoutRequest {
  payoutId: string;
  partnerId: string;
  upiVpa: string | null;
  netPaise: number;
}

export interface PayoutResult {
  ok: boolean;
  providerRef: string | null;
  failureReason?: string;
}

export interface PayoutProvider {
  readonly name: string;
  execute(req: PayoutRequest): Promise<PayoutResult>;
}

export class SimulatorPayoutProvider implements PayoutProvider {
  readonly name = 'payout-simulator@1.0';

  async execute(req: PayoutRequest): Promise<PayoutResult> {
    if (!req.upiVpa) {
      return { ok: false, providerRef: null, failureReason: 'NO_PAYOUT_INSTRUMENT' };
    }
    // Deterministic: the demo needs the same result every run (§21.2).
    return { ok: true, providerRef: `SIMPAY-${req.payoutId}` };
  }
}

export function payoutProvider(): PayoutProvider {
  return new SimulatorPayoutProvider();
}
