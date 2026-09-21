import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-stone-950 px-6 py-12">
      <div className="w-full max-w-md text-center">
        <h1 className="text-5xl font-bold tracking-tight text-white sm:text-6xl">
          Wavelength
        </h1>
        <p className="mt-3 text-stone-400">
          Read your team&apos;s mind. Land the needle on a target only the Psychic
          can see.
        </p>

        <div className="mt-10 flex flex-col gap-3">
          <Link
            href="/local"
            className="rounded-xl bg-white px-6 py-4 text-lg font-bold text-stone-900 transition-opacity hover:opacity-90"
          >
            Play on one device
          </Link>
          <p className="text-sm text-stone-500">
            Online rooms are coming next.
          </p>
        </div>
      </div>
    </main>
  );
}
