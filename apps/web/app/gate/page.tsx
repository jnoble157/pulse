import { gateSubmit } from './actions';

type Props = { searchParams: Promise<{ next?: string; error?: string }> };

export default async function GatePage({ searchParams }: Props) {
  const sp = await searchParams;
  return (
    <main className="mx-auto mt-16 max-w-[420px] px-4 py-12">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-2.5 w-2.5 rounded-full bg-accent-yellow shadow-[0_0_0_3px_rgba(245,197,24,0.18)]"
        />
        <span className="text-[17px] font-semibold tracking-tight text-text-primary">Pulse</span>
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-text-primary">Demo access</h1>
      <p className="mt-2 text-sm text-text-secondary">
        Private walkthrough. If you have the password, enter it below.
      </p>
      <form action={gateSubmit} className="mt-6 space-y-3">
        <input type="hidden" name="next" value={sp.next ?? '/'} />
        <label className="block text-sm text-text-secondary">
          <span className="sr-only">Password</span>
          <input
            type="password"
            name="password"
            autoFocus
            autoComplete="current-password"
            className="w-full rounded-md border border-border-strong bg-bg-surface px-3 py-2 font-mono text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-yellow"
            placeholder="password"
          />
        </label>
        {sp.error ? (
          <p className="text-sm text-fn-danger">That wasn&apos;t right.</p>
        ) : null}
        <button
          type="submit"
          className="w-full rounded-pill bg-accent-black px-5 py-2.5 text-base font-medium text-white transition-colors duration-150 ease-pulse hover:bg-accent-black-hover"
        >
          Enter
        </button>
      </form>
    </main>
  );
}
