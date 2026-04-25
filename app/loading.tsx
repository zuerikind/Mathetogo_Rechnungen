import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function Loading() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 bg-[#F0F5FF] px-4">
      <LoadingSpinner size={28} />
      <p className="text-sm font-medium text-gray-600">Inhalt wird geladen…</p>
    </div>
  );
}
