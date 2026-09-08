'use client';
import { useRouter } from 'next/navigation';

export function PartnerPicker({ partners, current }: {
  partners: { id: string; name: string; status: string }[];
  current: string;
}) {
  const router = useRouter();
  return (
    <div style={{ minWidth: 260 }}>
      <label htmlFor="partner-pick">Viewing as partner</label>
      <select id="partner-pick" value={current}
              onChange={(e) => router.push(`/partner?p=${e.target.value}`)}>
        {partners.map((p) => (
          <option key={p.id} value={p.id}>
            {p.id} — {p.name}{p.status !== 'VERIFIED' ? ` (${p.status.toLowerCase()})` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
