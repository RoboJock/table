"use client";

import { Suspense } from "react";
import { TableRoom } from "../../components/TableRoom";

export default function Page() {
  return (
    <Suspense fallback={<p className="status">Opening the table…</p>}>
      <TableRoom />
    </Suspense>
  );
}
