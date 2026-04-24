/**
 * Homepage — the voice agent demo.
 *
 * Single surface. Top: a phone number a visitor can dial, plus two sample
 * calls they can play to hear how the agent handles a normal order and an
 * edge case. Bottom: the live transcript area renders both the sample calls
 * and any real call coming in to the Twilio number, via the same SSE channel
 * (`/api/calls/live`) so there's no special-case path.
 *
 * No analytics dashboards on this page. The product is the agent.
 */
import Link from 'next/link';
import { CallStage } from '@/components/voice/CallStage';

export const dynamic = 'force-dynamic';

const TWILIO_NUMBER = process.env.TWILIO_PHONE_NUMBER ?? '+15752218619';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      <TopChrome />
      <main className="mx-auto w-full max-w-[920px] px-6 pb-24 pt-8 sm:px-8 sm:pt-10">
        <Hero />
        <div className="mt-8">
          <CallStage phoneNumber={TWILIO_NUMBER} />
        </div>
        <Notes />
        <Footer />
      </main>
    </div>
  );
}

function TopChrome() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg-base/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[920px] items-center justify-between px-6 sm:px-8">
        <Link href="/" className="flex items-center gap-2" aria-label="Pulse">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full bg-accent-yellow shadow-[0_0_0_3px_rgba(245,197,24,0.18)]"
          />
          <span className="text-[17px] font-semibold tracking-tight">Pulse</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm text-text-secondary">
          <a
            href="/menu.html"
            target="_blank"
            rel="noreferrer"
            className="underline-offset-4 hover:text-text-primary hover:underline"
          >
            Menu
          </a>
          <a href="#notes" className="underline-offset-4 hover:text-text-primary hover:underline">
            Notes
          </a>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h1 className="max-w-[28ch] text-[28px] font-semibold leading-[1.12] tracking-tight sm:text-[36px]">
          A voice agent that takes restaurant calls.
        </h1>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          Voice agent demo
        </p>
      </div>
      <p className="mt-4 max-w-[60ch] text-[15.5px] leading-[1.55] text-text-secondary">
        Built for Tony&rsquo;s Pizza in Austin (a fictional restaurant). Dial the number to talk to
        it yourself, or play a sample to hear how it handles a normal pickup order and an allergy
        question it can&rsquo;t safely answer.
      </p>
    </section>
  );
}

function Notes() {
  return (
    <section id="notes" className="mt-20 grid gap-10 sm:grid-cols-[180px_minmax(0,1fr)]">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">Notes</p>
        <h2 className="mt-2 text-[20px] font-semibold leading-tight tracking-tight">
          What you&rsquo;re hearing
        </h2>
      </header>
      <div className="space-y-4 text-[14.5px] leading-[1.6] text-text-secondary">
        <p>
          It&rsquo;s four pieces glued together: Twilio for the phone, Deepgram Nova-3 for streaming
          speech-to-text, Claude Sonnet 4.5 for the per-turn decision (one structured action: say,
          add_to_cart, lookup_menu_item, transfer, end), and ElevenLabs Flash v2.5 for the voice
          back. The whole loop is a small Node service in <code>apps/voice/</code>.
        </p>
        <p>
          The interesting bits are mostly about what shouldn&rsquo;t happen: the agent
          shouldn&rsquo;t talk over you, cut you off mid-thought, or quote a price it made up.
          Endpointing is Deepgram&rsquo;s UtteranceEnd plus a short hold on trail-off finals
          (&ldquo;I&rsquo;ll do a&hellip;&rdquo;). Pricing comes from the actual cart, whose running
          subtotal is injected into the prompt every turn so the LLM can&rsquo;t invent one.
          Allergens and anything dietary go to a human, not the model.
        </p>
        <p>
          Out of scope: multi-tenancy, real menu and POS sync, card capture, audio recording,
          anything other than English. Endpointing still misses edges when a caller pauses
          mid-sentence, which is the next thing I&rsquo;d harden. Code is all in github, happy to
          walk through any part of it.
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mt-20 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-8 text-xs text-text-muted">
      <p>Built by Josh Noble.</p>
      <div className="flex items-center gap-5">
        <a
          href="mailto:josh.noble13@gmail.com"
          className="underline-offset-4 hover:text-text-primary hover:underline"
        >
          Email
        </a>
        <a
          href="https://www.linkedin.com/in/josh-n-650238a1/"
          className="underline-offset-4 hover:text-text-primary hover:underline"
        >
          LinkedIn
        </a>
        <a
          href="https://github.com/jnoble157/pulse"
          className="underline-offset-4 hover:text-text-primary hover:underline"
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}
