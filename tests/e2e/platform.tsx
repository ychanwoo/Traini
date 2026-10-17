/* Platform adapters for the isolated component browser harness only. */
import type { AnchorHTMLAttributes, ImgHTMLAttributes } from "react";
export function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
export function Image({ unoptimized: _unoptimized, ...props }: ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) {
  void _unoptimized;
  // eslint-disable-next-line @next/next/no-img-element -- Real local image, without Next's image server.
  return <img {...props} alt={props.alt ?? ""} />;
}
export const usePathname = () => window.location.pathname;
export const useRouter = () => ({ back: () => window.history.back() });
export const getSupabaseBrowserClient = () => ({
  auth: { getSession: async () => ({ data: { session: { user: { id: "fixture-only" } } } }) },
});
