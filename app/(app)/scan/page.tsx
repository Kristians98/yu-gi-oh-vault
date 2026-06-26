import { Scanner } from "@/components/scanner";
import { aiConfigured } from "@/lib/azure-vision";

export const maxDuration = 60;

export default function ScanPage() {
  return (
    <>
      <header className="topbar">
        <div>
          <span className="page-eyebrow">Collection</span>
          <h1 className="page-title">Scan a card</h1>
        </div>
      </header>
      <Scanner aiEnabled={aiConfigured()} />
    </>
  );
}
