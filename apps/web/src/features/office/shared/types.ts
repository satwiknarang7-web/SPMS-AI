export interface Supplier { id: string; name: string; accountNo: string | null; contactName: string | null; email: string | null; phone: string | null; electronic: boolean; terms: string | null; _count: { products: number; orders: number } }

export interface Account { id: string; name: string; email: string | null; phone: string | null; creditLimit: number; balance: number; accountFee: number; patient: { id: string; firstName: string; lastName: string } | null }
