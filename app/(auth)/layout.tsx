export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container flex min-h-[calc(100vh-4rem)] items-center justify-center py-12">
      <div className="w-full max-w-[540px]">
        {children}
        <div className="label-mono-sm mt-4 flex items-center justify-between px-2 tracking-[0.2em]">
          <span>Latency: in-process [local-edge]</span>
          <span className="flex items-center gap-1.5">
            <span className="dot-live" /> Status: nominal
          </span>
        </div>
      </div>
    </div>
  );
}
