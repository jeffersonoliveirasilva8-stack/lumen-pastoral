import type { PaymentProvider } from './types'
import { MercadoPagoProvider } from './mercadopago'

export function getPaymentProvider(gateway: string): PaymentProvider {
  if (gateway === 'mercadopago') return new MercadoPagoProvider()
  throw new Error(`Unknown gateway: ${gateway}`)
}
