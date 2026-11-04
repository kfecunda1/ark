import { GlassCard } from "@/components/glass-card";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Settings</h1>
        <p className="mt-1 text-sm text-white/45">Workspace and account preferences.</p>
      </div>

      <GlassCard interactive={false} className="p-6">
        <p className="text-sm text-white/45">Settings will be configurable here in a future stage.</p>
      </GlassCard>
    </div>
  );
}
