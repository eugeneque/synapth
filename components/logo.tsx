/* eslint-disable @next/next/no-img-element -- tiny static brand assets; next/image adds nothing here. */

/** The Synapth mark (four nodes, one synapse) — square, sized by `className`. */
export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return <img src="/logo-mark.png" alt="" aria-hidden="true" width={256} height={256} className={`object-contain ${className}`} />;
}

/** Mark + wordmark lockup; height comes from `className`, width follows the aspect ratio. */
export function LogoWordmark({ className = "h-7" }: { className?: string }) {
  return <img src="/logo.png" alt="Synapth" width={469} height={96} className={`w-auto ${className}`} />;
}
