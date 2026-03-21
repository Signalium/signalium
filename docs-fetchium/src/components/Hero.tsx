import Image from 'next/image';

import { Button } from '@/components/Button';
import blurCyanImage from '@/images/blur-cyan.png';
import blurIndigoImage from '@/images/blur-indigo.png';

export function Hero() {
  return (
    <div className="mt-[-6.5rem] overflow-hidden bg-primary-950 pt-[6.5rem]">
      <div className="pb-8 sm:px-2 lg:relative lg:px-0">
        <div className="mx-auto grid max-w-4xl grid-cols-1 items-center gap-x-8 gap-y-8 px-4 pb-10 lg:min-h-[calc(100vh-10rem)] lg:max-w-8xl lg:gap-x-12 lg:px-8 xl:gap-x-16 xl:px-12">
          <div className="relative z-10 flex flex-col items-center justify-center text-center">
            <Image
              className="absolute right-full bottom-full -mr-72 -mb-56 opacity-40"
              src={blurCyanImage}
              alt=""
              width={530}
              height={530}
              unoptimized
              priority
            />
            <Image
              className="absolute -right-44 bottom-0 opacity-30"
              src={blurIndigoImage}
              alt=""
              width={567}
              height={567}
              unoptimized
              priority
            />

            <p className="inline bg-linear-to-r from-secondary-200 via-tertiary-300 to-secondary-300 bg-clip-text font-display text-[32px] tracking-tight text-transparent md:text-5xl lg:text-6xl">
              Data fetching. <br />
              Reimagined.
            </p>
            <p className="mt-4 max-w-2xl text-lg leading-snug tracking-tight text-primary-200 md:text-xl">
              Type-safe queries, automatic entity caching, and real-time updates
              — Fetchium is reactive data fetching built on Signalium.
            </p>
            <div className="mt-8 flex justify-center gap-4">
              <Button href="/#getting-started">Get started</Button>
              <Button
                href="https://github.com/Signalium/signalium"
                variant="secondary"
              >
                View on GitHub
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
