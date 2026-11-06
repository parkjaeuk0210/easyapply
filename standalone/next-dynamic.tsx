// next/dynamic 대체: 단일 HTML 빌드에는 Next.js 런타임이 없어서 React.lazy로 같은 일을 한다.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

type Loaded<P> = { default: ComponentType<P> } | ComponentType<P>;

export default function dynamic<P extends object>(
  loader: () => Promise<Loaded<P>>,
  opts?: { loading?: () => ReactNode; ssr?: boolean },
) {
  const Lazy = lazy(async () => {
    const m = await loader();
    return typeof m === "object" && m && "default" in m ? m : { default: m as ComponentType<P> };
  });
  return function Dynamic(props: P) {
    return (
      <Suspense fallback={opts?.loading?.() ?? null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
