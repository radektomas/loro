'use client';

/**
 * The Instagram Reels screen drawn around a reel, so a cut is judged with the
 * chrome that will sit on top of it: the header, the like/comment/share rail on
 * the right, the account + caption + audio at the bottom, and the tab bar.
 * Anything of the reel those cover is covered in the real app too.
 *
 * Proportions follow a 390x844 iPhone screen: the reel fills everything above
 * the 83 pt tab bar (object-fit: cover), which trims a little off each side of
 * a 9:16 video, exactly as Instagram does.
 */
import type { ReactNode } from 'react';

const sw = { fill: 'none', stroke: '#fff', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function Icon({ d, size = 26 }: { d: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...sw} style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.45))' }}>
      {d}
    </svg>
  );
}

const heart = <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.7 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.9 1.3-1.8 2.9-2.9 4.9-2.9 3.4 0 5.7 3.4 4.4 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" />;
const bubble = <path d="M20.5 12a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.2-4.2A8.5 8.5 0 1 1 20.5 12z" />;
const repost = (
  <>
    <path d="M4 10V8.5A3.5 3.5 0 0 1 7.5 5H19l-3-3M20 14v1.5a3.5 3.5 0 0 1-3.5 3.5H5l3 3" />
  </>
);
const send = (
  <>
    <path d="M21.5 3 10.5 13.5" />
    <path d="M21.5 3 15 21l-4.5-7.5L3 9z" />
  </>
);
const more = (
  <>
    <circle cx="5" cy="12" r="1.2" fill="#fff" />
    <circle cx="12" cy="12" r="1.2" fill="#fff" />
    <circle cx="19" cy="12" r="1.2" fill="#fff" />
  </>
);
const camera = (
  <>
    <rect x="3" y="6" width="18" height="14" rx="4" />
    <circle cx="12" cy="13" r="3.6" />
    <path d="M8.5 6 10 3.5h4L15.5 6" />
  </>
);

function Stat({ icon, n }: { icon: ReactNode; n?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <Icon d={icon} />
      {n && <span className="text-[11px] font-semibold text-white" style={{ textShadow: '0 1px 2px rgba(0,0,0,.5)' }}>{n}</span>}
    </div>
  );
}

const tabs = [
  <path key="h" d="M3.5 10.5 12 3.5l8.5 7V20a.5.5 0 0 1-.5.5h-5v-6h-6v6H4a.5.5 0 0 1-.5-.5z" />,
  <g key="s"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></g>,
  <g key="r"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" /><path d="M3.5 8.5h17M9 3.5l2.5 5M14.5 3.5l2.5 5" /><path d="m10.5 11.5 4 2.5-4 2.5z" fill="#fff" /></g>,
  <g key="d">{send}</g>,
];

export function ReelFrame({
  account,
  overlay,
  children,
}: {
  account: string;
  overlay: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-[28px] bg-black"
      style={{ aspectRatio: '390 / 844', boxShadow: '0 0 0 8px #1b1f1d, 0 18px 40px rgba(0,0,0,.5)' }}
    >
      <div className="absolute inset-x-0 top-0 bottom-[9.8%]">{children}</div>
      {!overlay && <div className="absolute inset-x-0 bottom-0 h-[9.8%] bg-black" />}
      {overlay && (
        <div className="pointer-events-none absolute inset-0 select-none" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif' }}>
          {/* status bar + header */}
          <div className="absolute inset-x-0 top-0 h-[13%]" style={{ background: 'linear-gradient(rgba(0,0,0,.35), transparent)' }} />
          <div className="absolute left-[6%] right-[6%] top-[2.2%] flex justify-between text-[12px] font-semibold text-white">
            <span>9:41</span>
            <span>▂▄▆ ◔</span>
          </div>
          <div className="absolute left-[5%] right-[5%] top-[6.2%] flex items-center justify-between">
            <span className="text-[19px] font-bold text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,.4)' }}>
              Reels <span className="text-[13px]">⌄</span>
            </span>
            <Icon d={camera} />
          </div>

          {/* right rail */}
          <div className="absolute bottom-[15%] right-[3%] flex flex-col items-center gap-[14px]">
            <Stat icon={heart} n="12.4K" />
            <Stat icon={bubble} n="318" />
            <Stat icon={repost} n="96" />
            <Stat icon={send} n="1,204" />
            <Stat icon={more} />
            <div className="h-[26px] w-[26px] rounded-md border-2 border-white" style={{ background: 'linear-gradient(135deg,#34d399,#0b6b4a)' }} />
          </div>

          {/* account, caption, audio */}
          <div className="absolute bottom-[11.5%] left-[4%] right-[22%] text-white" style={{ textShadow: '0 1px 2px rgba(0,0,0,.5)' }}>
            <div className="flex items-center gap-2">
              <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-[13px] font-black" style={{ background: '#34d399', color: '#0b0f0d' }}>
                {account[0]?.toUpperCase()}
              </span>
              <span className="text-[13px] font-semibold">{account}</span>
              <span className="rounded-lg border border-white/80 px-2 py-[1px] text-[12px] font-semibold">Follow</span>
            </div>
            <p className="mt-1.5 truncate text-[13px]">the app is in my bio 🦜 … <span className="opacity-70">more</span></p>
            <p className="mt-1 truncate text-[12px] opacity-90">♫ {account} · Original audio</p>
          </div>

          {/* tab bar */}
          <div className="absolute inset-x-0 bottom-0 flex h-[9.8%] items-start justify-around bg-black pt-[2.4%]">
            {tabs.map((t, i) => (
              <Icon key={i} d={t} size={24} />
            ))}
            <span className="h-[24px] w-[24px] rounded-full border-2 border-white" style={{ background: '#2b3430' }} />
          </div>
        </div>
      )}
    </div>
  );
}
