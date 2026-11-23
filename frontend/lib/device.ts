export type DeviceVerdict = { allowed: boolean; reason?: string };

export function detectDevice(): DeviceVerdict {
  const nav: any = navigator;
  const ua = nav.userAgent || "";
  const platform = nav.userAgentData?.platform || nav.platform || "";
  if (nav.userAgentData?.mobile) return { allowed: false, reason: "client-hints mobile" };
  if (/Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle|CrOS|Windows Phone/i.test(ua)) return { allowed: false, reason: "mobile UA" };
  // iPadOS pretends to be a Mac but has multi-touch
  if (/Mac/i.test(platform) && nav.maxTouchPoints > 1) return { allowed: false, reason: "iPadOS" };
  const long = Math.max(screen.width, screen.height), short = Math.min(screen.width, screen.height);
  if (long < 1024 || short < 600) return { allowed: false, reason: "small screen" };
  // touch-only device (no mouse/trackpad). Touchscreen laptops still report a fine pointer.
  if (nav.maxTouchPoints > 0 && matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches)
    return { allowed: false, reason: "touch only" };
  const okOS = /Win|Mac|Linux|X11/i.test(platform + " " + ua);
  if (!okOS) return { allowed: false, reason: "unsupported OS" };
  return { allowed: true };
}
