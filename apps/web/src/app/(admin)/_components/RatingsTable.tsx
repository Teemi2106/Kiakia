import Link from "next/link";
import { formatDateTime } from "./format";
import { Table, Td, Th, Tr } from "./Table";

interface RatingRow {
  readonly orderId: string;
  readonly orderCode: string | null;
  readonly rating: number;
  readonly comment: string | null;
  readonly customerName?: string | null;
  readonly createdAt: string;
}

/** Recent ratings table for the vendor and rider detail pages; pass showCustomer when rows carry a customer name. */
export function RatingsTable({ ratings, showCustomer = false }: { ratings: readonly RatingRow[]; showCustomer?: boolean }) {
  return (
    <Table
      head={
        <>
          <Th>Rating</Th>
          <Th>Comment</Th>
          {showCustomer && <Th>Customer</Th>}
          <Th>Order</Th>
          <Th>Date</Th>
        </>
      }
    >
      {ratings.map((rating) => (
        <Tr key={rating.orderId}>
          <Td>{rating.rating}/5</Td>
          <Td className="max-w-xs whitespace-pre-wrap break-words">{rating.comment ?? "-"}</Td>
          {showCustomer && <Td>{rating.customerName ?? "-"}</Td>}
          <Td>
            <Link href={`/admin/orders/${rating.orderId}`} className="font-medium text-brand-600 hover:underline">
              {rating.orderCode ?? "View order"}
            </Link>
          </Td>
          <Td>{formatDateTime(rating.createdAt)}</Td>
        </Tr>
      ))}
    </Table>
  );
}
