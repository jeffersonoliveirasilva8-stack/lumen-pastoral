export interface PaymentProvider {
  createPreference(params: CreatePreferenceParams): Promise<PreferenceResult>
  getPayment(paymentId: string): Promise<NormalizedPayment>
  validateWebhook(payload: string, signature: string): boolean
}

export interface CreatePreferenceParams {
  paroquia_id: string
  plan_slug: string
  plan_name: string
  price_brl: number
  payer_email: string
  external_reference: string
  back_url_success: string
  back_url_failure: string
}

export interface PreferenceResult {
  preference_id: string
  init_point: string
}

export interface NormalizedPayment {
  id: string
  status: 'approved' | 'pending' | 'rejected' | 'cancelled'
  external_reference: string
  amount: number
  payer_email: string
  gateway: string
}

export interface NormalizedWebhookEvent {
  gateway: 'mercadopago'
  event_type: string
  idempotency_key: string
  raw_payload: Record<string, unknown>
  payment?: NormalizedPayment
}
