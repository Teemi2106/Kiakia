import { OrderStatusBadge } from "@kiakia/ui";
import Link from "next/link";
import { formatDateTime, money } from "./format";
import { StatusPill } from "./StatusPill";
import { Table, Td, Th, Tr } from "./Table";
import type { OrderStatus } from "@kiakia/db";

interface OrderRow {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatus;
  readonly paymentStatus: string;
  readonly totalKobo: number;
  readonly createdAt: string;
}

/** Compact orders table for the vendor / rider / user detail pages. */
export function OrderRows({ orders }: { orders: readonly OrderRow[] }) {
  return (
    <Table
      head={
        <>
          <Th>Order</Th>
          <Th>Status</Th>
          <Th>Payment</Th>
          <Th className="text-right">Total</Th>
          <Th>Placed</Th>
        </>
      }
    >
      {orders.map((order) => (
        <Tr key={order.id}>
          <Td>
            <Link href={`/admin/orders/${order.id}`} className="font-medium text-brand-600 hover:underline">
              {order.code}
            </Link>
          </Td>
          <Td>
            <OrderStatusBadge status={order.status} />
          </Td>
          <Td>
            <StatusPill status={order.paymentStatus} />
          </Td>
          <Td className="text-right">{money(order.totalKobo)}</Td>
          <Td>{formatDateTime(order.createdAt)}</Td>
        </Tr>
      ))}
    </Table>
  );
}
