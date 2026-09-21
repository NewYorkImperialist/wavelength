import Link from "next/link";

import { HomeForms } from "./HomeForms";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-stone-950 px-6 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-5xl font-bold tracking-tight text-white sm:text-6xl">
          Wavelength
        </h1>
        <p className="mt-3 text-center text-stone-400">
          Read your team&apos;s mind. Land the needle on a target only the
          Psychic can see.
        </p>

        <HomeForms />

        <p className="mt-8 text-center text-sm text-stone-500">
          No account needed. Or{" "}
          <Link href="/local" className="underline underline-offset-4 hover:text-stone-300">
            play on one device
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
