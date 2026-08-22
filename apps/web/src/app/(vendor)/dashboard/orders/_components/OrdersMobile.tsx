// app/(vendor)/orders/_components/OrdersMobile.tsx
"use client";

import { useState } from "react";
import { OrderList } from "./OrderList";
import { formatNaira, koboOf } from "@kiakia/domain";
import { OrderModal } from "./OrderModal";
import type { Order } from "./types";

interface OrdersMobileProps {
  orders: Order[];
  onStatusChange: (orderId: string, status: string) => void;
}

export function OrdersMobile({ orders, onStatusChange }: OrdersMobileProps) {
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleSelectOrder = (order: Order) => {
    setSelectedOrder(order);
    setIsModalOpen(true);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 px-4 pt-4">
        <button className="rounded-full bg-[#B61913] px-6 py-2 text-sm font-medium text-white whitespace-nowrap">
          Incoming (3)
        </button>
        <button className="rounded-full bg-[#F0EDED] px-6 py-2 text-sm font-medium text-[#5B403C] whitespace-nowrap">
          Preparing (12)
        </button>
        <button className="rounded-full bg-[#F0EDED] px-6 py-2 text-sm font-medium text-[#5B403C] whitespace-nowrap">
          Ready (5)
        </button>
        <button className="rounded-full bg-[#F0EDED] px-6 py-2 text-sm font-medium text-[#5B403C] whitespace-nowrap">
          Past Orders
        </button>
      </div>

      {/* Orders Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 gap-4">
          {orders.map((order) => (
            <div
              key={order.id}
              className="bg-white p-6 rounded-2xl border border-[#E4BEB8] shadow-sm hover:shadow-md transition-all cursor-pointer relative overflow-hidden"
              onClick={() => handleSelectOrder(order)}
            >
              <div className="absolute top-0 left-0 w-1.5 h-full bg-[#934B00]" />
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="text-sm text-[#5B403C] mb-1">
                    {new Date(order.created_at).toLocaleTimeString()}
                  </p>
                  <h3 className="font-sora text-xl font-bold text-[#1C1B1B]">
                    {order.code}
                  </h3>
                </div>
                <span className="bg-[rgba(147,75,0,0.1)] text-[#934B00] px-3 py-1 rounded-full text-xs font-bold uppercase">
                  {order.status}
                </span>
              </div>
              <div className="space-y-2 mb-6">
                {order.items?.slice(0, 2).map((item) => (
                  <p key={item.id} className="text-sm text-[#1C1B1B]">
                    {item.quantity}x {item.name}
                  </p>
                ))}
                {(order.items?.length || 0) > 2 && (
                  <p className="text-sm text-[#5B403C]">
                    +{(order.items?.length || 0) - 2} more items
                  </p>
                )}
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-[#F0EDED] flex items-center justify-center">
                    <span className="text-sm">👤</span>
                  </div>
                  <span className="text-sm text-[#5B403C]">
                    {order.customer_name || "Customer"}
                  </span>
                </div>
                <p className="font-sora text-xl font-bold text-[#B61913]">
                  {formatNaira(koboOf(order.total_kobo))}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Order Modal */}
      <OrderModal
        order={selectedOrder}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onStatusChange={onStatusChange}
      />
    </div>
  );
}
