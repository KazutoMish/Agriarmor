export interface Product {
  id: string; name: string; description: string; price: number; image_url: string | null;
  category: string; stock: number; is_available: boolean; created_at: string;
}
export interface Promo {
  id: string; code: string | null; banner_text: string | null; discount_type: 'percent' | 'fixed';
  discount_value: number; starts_at: string | null; ends_at: string | null; is_active: boolean;
}
export interface OrderItem {
  id?: string; product_id: string | null; name_snapshot: string; price_snapshot: number; quantity: number;
}
export type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'out_for_delivery' | 'ready' | 'completed' | 'cancelled';
export type PaymentMethod = 'cod' | 'gcash' | 'bank_transfer' | 'pay_on_pickup';
export interface Order {
  id: string; order_number: string; customer_name: string; phone: string; email: string | null;
  fulfillment_type: 'delivery' | 'pickup'; address: string | null; scheduled_at: string | null;
  notes: string | null; payment_method: PaymentMethod; payment_reference: string | null;
  payment_proof_url?: string | null; has_payment_proof?: boolean; subtotal: number; discount: number; delivery_fee: number;
  total: number; status: OrderStatus; created_at: string; order_items: OrderItem[];
}
export interface CartItem { product_id: string; quantity: number }
export interface Quote { subtotal: number; discount: number; delivery_fee: number; total: number }
