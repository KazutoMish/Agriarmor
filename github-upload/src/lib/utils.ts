export const formatMoney = (value: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2, minimumFractionDigits: Number(value) % 1 ? 2 : 0 }).format(Number(value));
export const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(value)) : 'Not specified';
export const statusLabel = (value: string) => ({ pending: 'Order received', confirmed: 'Confirmed', preparing: 'Preparing', out_for_delivery: 'Out for delivery', ready: 'Ready for pickup', completed: 'Completed', cancelled: 'Cancelled' }[value] || value);
export const deliveryFee = (subtotal: number, fulfillment: string) => fulfillment === 'pickup' || subtotal >= 499 ? 0 : 60;
export const paymentLabel = (value: string) => ({ cod: 'Cash on delivery', gcash: 'GCash', bank_transfer: 'Bank transfer', pay_on_pickup: 'Pay on pickup' }[value] || value);
export const errorMessage = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Something went wrong. Please try again.';
