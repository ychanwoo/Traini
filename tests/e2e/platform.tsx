/* Platform adapters for the isolated component browser harness only. */
import { useSyncExternalStore, type AnchorHTMLAttributes, type ImgHTMLAttributes } from "react";
export function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} onClick={e => { props.onClick?.(e); if(!e.defaultPrevented && props.href?.startsWith("/") && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {e.preventDefault(); window.history.pushState(null,"",props.href);window.dispatchEvent(new PopStateEvent("popstate"));}}} />;
}
export function Image({ unoptimized: _unoptimized, ...props }: ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) {
  void _unoptimized;
  // eslint-disable-next-line @next/next/no-img-element -- Real local image, without Next's image server.
  return <img {...props} alt={props.alt ?? ""} />;
}
export const usePathname = () => useSyncExternalStore(listener => { window.addEventListener("popstate",listener);return () => window.removeEventListener("popstate",listener); }, () => window.location.pathname, () => "/schedule");
const fixtureRouter = {back: () => window.history.back(), replace: (url: string) => {window.history.replaceState(null,"",url);window.dispatchEvent(new PopStateEvent("popstate"));}};
export const useRouter = () => fixtureRouter;
export const getSupabaseBrowserClient = () => ({
  auth: {
    getSession: async () => ({data: {session: {user: {id:"fixture-only",user_metadata:{}}}}}),
    onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
      const listener = () => callback("SIGNED_IN", {user:{id:"fixture-only",user_metadata:{}}});
      window.addEventListener("fixture:auth-recheck",listener);
      return {data:{subscription:{unsubscribe:()=>window.removeEventListener("fixture:auth-recheck",listener)}}};
    },
    signOut: async () => ({error:null}),
  },
  from: () => ({upsert: async () => ({error:null})}),
});
