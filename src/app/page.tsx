"use client";

import { useState, useCallback, useEffect } from "react";
import { Heart, RefreshCw, BookOpen, Clock, Settings, Sparkles } from "lucide-react";
import { getRandomPassage, getAllPassages, type Passage } from "@/lib/passages";

function PassageCard({ passage, onNext, onFavorite, isFavorited }: {
  passage: Passage;
  onNext: () => void;
  onFavorite: () => void;
  isFavorited: boolean;
}) {
  return (
    <div className="card bg-base-200 shadow-xl max-w-lg w-full mx-auto">
      <div className="card-body">
        <div className="flex items-center gap-2 text-sm opacity-60 mb-2">
          <BookOpen size={14} />
          <span>《{passage.bookTitle}》</span>
        </div>
        <p className="text-sm opacity-50 mb-4">{passage.author}</p>

        <blockquote className="text-lg leading-relaxed border-l-4 border-primary pl-4 my-4 italic">
          &ldquo;{passage.text}&rdquo;
        </blockquote>

        {passage.chapter && (
          <p className="text-xs opacity-40 mt-2">{passage.chapter}</p>
        )}

        <div className="flex flex-wrap gap-1 mt-3">
          {passage.tags.map((tag) => (
            <span key={tag} className="badge badge-outline badge-sm">{tag}</span>
          ))}
        </div>

        <div className="card-actions justify-between mt-6">
          <button
            className={`btn btn-sm ${isFavorited ? "btn-error" : "btn-ghost"}`}
            onClick={onFavorite}
          >
            <Heart size={16} fill={isFavorited ? "currentColor" : "none"} />
            {isFavorited ? "已收藏" : "收藏"}
          </button>
          <button className="btn btn-sm btn-primary" onClick={onNext}>
            <RefreshCw size={16} />
            下一段
          </button>
        </div>
      </div>
    </div>
  );
}

type Tab = "discover" | "bookshelf" | "history" | "settings";

export default function Home() {
  const [passage, setPassage] = useState<Passage | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("discover");

  useEffect(() => {
    setPassage(getRandomPassage());
    const saved = localStorage.getItem("rp-favorites");
    if (saved) setFavorites(JSON.parse(saved));
  }, []);

  const next = useCallback(() => {
    setPassage(getRandomPassage());
  }, []);

  const toggleFavorite = useCallback(() => {
    if (!passage) return;
    setFavorites((prev) => {
      const next = prev.includes(passage.id)
        ? prev.filter((id) => id !== passage.id)
        : [...prev, passage.id];
      localStorage.setItem("rp-favorites", JSON.stringify(next));
      return next;
    });
  }, [passage]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="navbar bg-base-200 justify-center">
        <h1 className="text-xl font-bold">📖 RandomPage</h1>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center p-4">
        {tab === "discover" && passage && (
          <PassageCard
            passage={passage}
            onNext={next}
            onFavorite={toggleFavorite}
            isFavorited={favorites.includes(passage.id)}
          />
        )}
        {tab === "bookshelf" && (
          <div className="w-full max-w-lg mx-auto">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Heart size={20} className="text-error" />
              我的书架 · {favorites.length} 个收藏
            </h2>
            {favorites.length === 0 ? (
              <div className="text-center opacity-50 py-12">
                <Heart size={48} className="mx-auto mb-4" />
                <p>还没有收藏片段</p>
                <p className="text-sm mt-2">在「发现」页点击 ❤️ 收藏喜欢的片段</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {getAllPassages()
                  .filter((p) => favorites.includes(p.id))
                  .map((p) => (
                    <div key={p.id} className="card bg-base-200 shadow-sm">
                      <div className="card-body p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm opacity-60">
                            <BookOpen size={14} />
                            <span>《{p.bookTitle}》</span>
                          </div>
                          <button
                            className="btn btn-ghost btn-xs text-error"
                            onClick={() => {
                              setFavorites((prev) => {
                                const next = prev.filter((id) => id !== p.id);
                                localStorage.setItem("rp-favorites", JSON.stringify(next));
                                return next;
                              });
                            }}
                          >
                            <Heart size={14} fill="currentColor" />
                          </button>
                        </div>
                        <p className="text-xs opacity-40">{p.author}</p>
                        <blockquote className="text-sm leading-relaxed border-l-2 border-primary pl-3 my-2 italic line-clamp-3">
                          &ldquo;{p.text}&rdquo;
                        </blockquote>
                        <div className="flex flex-wrap gap-1">
                          {p.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="badge badge-outline badge-xs">{tag}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
        {tab === "history" && (
          <div className="text-center opacity-50">
            <Clock size={48} className="mx-auto mb-4" />
            <p>浏览历史</p>
            <p className="text-sm mt-2">Phase 2 功能</p>
          </div>
        )}
        {tab === "settings" && (
          <div className="text-center opacity-50">
            <Settings size={48} className="mx-auto mb-4" />
            <p>设置</p>
            <p className="text-sm mt-2">Phase 2 功能</p>
          </div>
        )}
      </main>

      {/* Bottom Nav */}
      <nav className="btm-nav btm-nav-sm bg-base-200">
        <button className={tab === "discover" ? "active" : ""} onClick={() => setTab("discover")}>
          <Sparkles size={20} />
          <span className="btm-nav-label text-xs">发现</span>
        </button>
        <button className={tab === "bookshelf" ? "active" : ""} onClick={() => setTab("bookshelf")}>
          <Heart size={20} />
          <span className="btm-nav-label text-xs">书架</span>
        </button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          <Clock size={20} />
          <span className="btm-nav-label text-xs">历史</span>
        </button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
          <Settings size={20} />
          <span className="btm-nav-label text-xs">设置</span>
        </button>
      </nav>
    </div>
  );
}
