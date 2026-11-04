"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { PRODUCT_TYPES } from "@/lib/products";

const selectClass =
  "rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]";

export function ContactFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  useEffect(() => {
    const currentQ = searchParams.get("q") ?? "";
    if (query === currentQ) return;

    const timeout = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (query) {
        params.set("q", query);
      } else {
        params.delete("q");
      }
      router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
    }, 300);

    return () => clearTimeout(timeout);
  }, [query, searchParams, pathname, router]);

  function setProduct(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set("product_type", value);
    } else {
      params.delete("product_type");
    }
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/30" />
        <input
          type="text"
          aria-label="Search contacts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or notes…"
          className="w-72 rounded-lg border border-white/[0.06] bg-white/[0.03] py-2 pr-3 pl-9 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-150 ease-out focus:border-accent/40 focus:bg-white/[0.06]"
        />
      </div>

      <select
        aria-label="Filter by product"
        value={searchParams.get("product_type") ?? ""}
        onChange={(e) => setProduct(e.target.value)}
        className={selectClass}
      >
        <option value="" className="bg-[#0a0e17]">
          All products
        </option>
        {PRODUCT_TYPES.map((product) => (
          <option key={product} value={product} className="bg-[#0a0e17]">
            {product}
          </option>
        ))}
      </select>
    </div>
  );
}
