import { useState, useEffect } from 'react';
import { Send, Users, ExternalLink, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GlassPanel } from '@/components/ui/GlassPanel';

export function DiscordSection() {
  const [animeCharacter, setAnimeCharacter] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch('https://api.waifu.pics/sfw/waifu')
      .then(r => r.json())
      .then(d => setAnimeCharacter(d.url))
      .catch(() => setAnimeCharacter('https://placehold.co/400x600/1a1a2e/ffffff?text=BeatAni'))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <section className="py-20 px-6">
      <div className="max-w-7xl mx-auto">
        <GlassPanel className="overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
            <div className="p-10 lg:p-16 flex flex-col justify-center space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-[#2AABEE]/20 flex items-center justify-center">
                  <Send className="w-6 h-6 text-[#2AABEE]" />
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-white">Join BeatAni Community</h2>
                  <p className="text-muted-foreground">Stream Every where, together</p>
                </div>
              </div>
              <p className="text-muted-foreground text-lg leading-relaxed">
                Join our Telegram community! Get instant support, anime news, episode alerts,
                and connect with fellow fans.
              </p>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                    <Send className="w-4 h-4 text-[#2AABEE]" />
                  </div>
                  <span>Support & announcements channel</span>
                </div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                    <MessageCircle className="w-4 h-4 text-[#2AABEE]" />
                  </div>
                  <span>Active discussion group chat</span>
                </div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                    <Users className="w-4 h-4 text-[#2AABEE]" />
                  </div>
                  <span>Friendly anime community</span>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button asChild className="bg-[#2AABEE] hover:bg-[#2AABEE]/80 text-white">
                  <a href="https://t.me/BeatAnime" target="_blank" rel="noopener noreferrer">
                    <Send className="w-4 h-4 mr-2" /> Join Support Channel
                  </a>
                </Button>
                <Button asChild variant="outline" className="border-[#2AABEE]/30 hover:border-[#2AABEE]/60">
                  <a href="https://t.me/beat_anime_discussion" target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="w-4 h-4 mr-2" /> Discussion Group
                    <ExternalLink className="w-3 h-3 ml-1" />
                  </a>
                </Button>
              </div>
            </div>
            <div className="relative h-64 lg:h-auto overflow-hidden">
              {isLoading ? (
                <div className="absolute inset-0 bg-gradient-to-br from-[#2AABEE]/10 to-primary/10 animate-pulse" />
              ) : (
                <img src={animeCharacter} alt="Anime Character"
                  className="w-full h-full object-cover object-top" />
              )}
              <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-transparent" />
              <div className="absolute bottom-6 left-6 right-6 lg:hidden">
                <div className="flex gap-3">
                  <Button asChild size="sm" className="bg-[#2AABEE] hover:bg-[#2AABEE]/80 text-white">
                    <a href="https://t.me/BeatAnime" target="_blank" rel="noopener noreferrer">
                      <Send className="w-3 h-3 mr-1" /> Support
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href="https://t.me/beat_anime_discussion" target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="w-3 h-3 mr-1" /> Discussion
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </GlassPanel>
      </div>
    </section>
  );
}
