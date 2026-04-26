import { Link } from 'react-router-dom';
import { Heart, MessageCircle, ExternalLink, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

const SOCIAL_LINKS = [
  { icon: Send, label: 'Telegram Support', url: 'https://t.me/BeatAnime', color: 'hover:text-[#2AABEE]' },
  { icon: MessageCircle, label: 'Discussion Group', url: 'https://t.me/beat_anime_discussion', color: 'hover:text-[#2AABEE]' },
];

const FOOTER_LINKS = {
  Product: [
    { label: 'Home', path: '/' },
    { label: 'Collections', path: '/collections' },
    { label: 'Trending', path: '/trending' },
    { label: 'Suggestions', path: '/suggestions' },
  ],
  Support: [
    { label: 'Telegram Channel', path: 'https://t.me/BeatAnime', isExternal: true },
    { label: 'Discussion Group', path: 'https://t.me/beat_anime_discussion', isExternal: true },
    { label: 'Terms of Service', path: '/terms' },
    { label: 'Privacy Policy', path: '/privacy' },
    { label: 'DMCA', path: '/dmca' },
  ],
  Browse: [
    { label: 'Anime', path: '/' },
    { label: 'Manga', path: '/manga' },
    { label: 'Schedule', path: '/schedule' },
    { label: 'Community', path: '/community' },
  ]
};

export function Footer() {
  return (
    <footer className="relative pt-20 pb-10 overflow-hidden border-t border-white/5 bg-black/40 backdrop-blur-xl">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px] transform translate-y-1/2 -translate-x-1/2 mix-blend-screen" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[120px] transform translate-y-1/2 translate-x-1/2 mix-blend-screen" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
      </div>
      <div className="max-w-7xl mx-auto px-6 relative">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 mb-16">
          <div className="lg:col-span-5 space-y-6">
            <Link to="/" className="block w-fit group">
              <h2 className="text-4xl font-black tracking-tighter text-white font-display group-hover:opacity-80 transition-opacity">BEATANI</h2>
              <p className="text-primary text-sm font-medium tracking-wider">STREAM EVERY WHERE</p>
            </Link>
            <p className="text-muted-foreground leading-relaxed max-w-md text-lg font-medium">
              The next generation anime streaming platform. Sleek, fast, and community-driven.
            </p>
            <div className="flex items-center gap-4">
              {SOCIAL_LINKS.map((social) => (
                <a key={social.label} href={social.url} target="_blank" rel="noopener noreferrer"
                  className={cn("w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center transition-all hover:scale-110 hover:bg-white/10", social.color)}
                  aria-label={social.label}>
                  <social.icon className="w-5 h-5" />
                </a>
              ))}
            </div>
          </div>
          <div className="lg:col-span-7 grid grid-cols-2 md:grid-cols-3 gap-8">
            {Object.entries(FOOTER_LINKS).map(([category, links]) => (
              <div key={category} className="space-y-4">
                <h3 className="font-bold text-lg text-white">{category}</h3>
                <ul className="space-y-3">
                  {links.map((link) => (
                    <li key={link.label}>
                      {link.isExternal ? (
                        <a href={link.path} target="_blank" rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-white transition-colors flex items-center gap-1 group">
                          {link.label}
                          <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </a>
                      ) : (
                        <Link to={link.path} className="text-muted-foreground hover:text-white transition-colors">{link.label}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <span>Made with</span><Heart className="w-4 h-4 text-red-500 fill-red-500" /><span>by BeatAni</span>
          </div>
          <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} BeatAni - Stream Every where. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <a href="https://t.me/BeatAnime" target="_blank" rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-[#2AABEE] transition-colors flex items-center gap-1">
              <Send className="w-3 h-3" /> Support
            </a>
            <a href="https://t.me/beat_anime_discussion" target="_blank" rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-[#2AABEE] transition-colors flex items-center gap-1">
              <MessageCircle className="w-3 h-3" /> Discussion
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
