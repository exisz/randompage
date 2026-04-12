"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Heart, RefreshCw, BookOpen, Clock, Settings, Sparkles, LogOut, Bell, Inbox } from "lucide-react";
import { usePushNotifications } from "@/hooks/usePushNotifications";

interface Passage {
  id: string;
  text: string;
  bookTitle: string;
  author: string;
  chapter?: string;
  tags: string[];
  language: string;
}

interface HistoryEntry {
  passageId: string;
  viewedAt: number;
}

interface PushHistoryItem {
  id: string;
  passageId: string;
  sentAt: string;
  readAt: string | null;
  text: string;
  bookTitle: string;
  author: string;
  chapter?: string;
  tags: string[];
  language: string;
}

type Tab = "discover" | "inbox" | "bookshelf" | "history" | "settings";

const TAB_ROUTES: Record<Tab, string> = {
  discover: "/",
  inbox: "/inbox",
  bookshelf: "/bookmarks",
  history: "/history",
  settings: "/settings",
};

const ROUTE_TABS: Record<string, Tab> = {
  "/": "discover",
  "/inbox": "inbox",
  "/bookmarks": "bookshelf",
  "/history": "history",
  "/settings": "settings",
};

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

export default function RandomPageApp() {
  const router = useRouter();
  const pathname = usePathname();
  const tab: Tab = ROUTE_TABS[pathname] ?? "discover";

  const [passage, setPassage] = useState<Passage | null>(null);
  const [allPassages, setAllPassages] = useState<Passage[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [testPushStatus, setTestPushStatus] = useState<string | null>(null);
  const [pushInbox, setPushInbox] = useState<PushHistoryItem[]>([]);
  const [inboxLoaded, setInboxLoaded] = useState(false);
  const push = usePushNotifications();

  const setTab = useCallback((t: Tab) => {
    router.push(TAB_ROUTES[t]);
  }, [router]);

  // Sync bookmarks from server on mount
  useEffect(() => {
    fetch('/api/bookmarks')
      .then((r) => r.ok ? r.json() : [])
      .then((ids) => {
        if (Array.isArray(ids)) {
          setFavorites(ids);
          localStorage.setItem('rp-favorites', JSON.stringify(ids));
        }
      })
      .catch(() => {
        const saved = localStorage.getItem('rp-favorites');
        if (saved) setFavorites(JSON.parse(saved));
      });
  }, []);

  const addToHistory = useCallback((passageId: string) => {
    setHistory((prev) => {
      const filtered = prev.filter((h) => h.passageId !== passageId);
      const next = [{ passageId, viewedAt: Date.now() }, ...filtered].slice(0, 100);
      localStorage.setItem("rp-history", JSON.stringify(next));
      return next;
    });
  }, []);

  // Fetch inbox on mount for badge count
  useEffect(() => {
    fetch('/api/push/history')
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        if (Array.isArray(data)) setPushInbox(data);
        setInboxLoaded(true);
      })
      .catch(() => setInboxLoaded(true));
  }, []);

  // Fetch inbox
  useEffect(() => {
    if (tab === "inbox" && !inboxLoaded) {
      fetch('/api/push/history')
        .then((r) => r.ok ? r.json() : [])
        .then((data) => {
          if (Array.isArray(data)) setPushInbox(data);
          setInboxLoaded(true);
        })
        .catch(() => setInboxLoaded(true));
    }
  }, [tab, inboxLoaded]);

  const markAsRead = useCallback((pushHistoryId: string) => {
    fetch('/api/push/history', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pushHistoryId }),
    });
    setPushInbox((prev) =>
      prev.map((item) =>
        item.id === pushHistoryId ? { ...item, readAt: new Date().toISOString() } : item
      )
    );
  }, []);

  const searchParams = useSearchParams();

  const fetchRandom = useCallback(async () => {
    const res = await fetch("/api/passages/random");
    if (res.ok) {
      const p = await res.json();
      setPassage(p);
      addToHistory(p.id);
    }
  }, [addToHistory]);

  useEffect(() => {
    const passageId = searchParams.get("passageId");
    if (passageId) {
      fetch(`/api/passages/${passageId}`)
        .then((r) => r.ok ? r.json() : null)
        .then((p) => {
          if (p) {
            setPassage(p);
            addToHistory(p.id);
          } else {
            fetchRandom();
          }
          // Clean up URL
          window.history.replaceState(null, '', '/');
        })
        .catch(() => fetchRandom());
    } else {
      fetchRandom();
    }
    const savedHistory = localStorage.getItem("rp-history");
    if (savedHistory) setHistory(JSON.parse(savedHistory));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if ((tab === "bookshelf" || tab === "history") && allPassages.length === 0) {
      fetch("/api/passages")
        .then((r) => r.json())
        .then((data) => { if (Array.isArray(data)) setAllPassages(data); });
    }
  }, [tab, allPassages.length]);

  const toggleFavorite = useCallback(() => {
    if (!passage) return;
    setFavorites((prev) => {
      const isFav = prev.includes(passage.id);
      const next = isFav
        ? prev.filter((id) => id !== passage.id)
        : [...prev, passage.id];
      localStorage.setItem("rp-favorites", JSON.stringify(next));
      if (isFav) {
        fetch('/api/bookmarks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passageId: passage.id }) });
      } else {
        fetch('/api/bookmarks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passageId: passage.id }) });
      }
      return next;
    });
  }, [passage]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="navbar bg-base-200 justify-center relative">
        <h1 className="text-xl font-bold">📖 RandomPage</h1>
        <button className="btn btn-ghost btn-sm absolute right-2" onClick={handleLogout}>
          <LogOut size={16} />
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        {tab === "discover" && passage && (
          <PassageCard
            passage={passage}
            onNext={fetchRandom}
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
                {allPassages
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
                                fetch('/api/bookmarks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passageId: p.id }) });
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
          <div className="w-full max-w-lg mx-auto">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Clock size={20} />
              浏览历史 · {history.length} 条记录
            </h2>
            {history.length === 0 ? (
              <div className="text-center opacity-50 py-12">
                <Clock size={48} className="mx-auto mb-4" />
                <p>还没有浏览记录</p>
                <p className="text-sm mt-2">在「发现」页浏览片段会自动记录</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {history.map((entry) => {
                  const p = allPassages.find((ap) => ap.id === entry.passageId);
                  if (!p) return null;
                  return (
                    <div key={entry.passageId + entry.viewedAt} className="card bg-base-200 shadow-sm">
                      <div className="card-body p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm opacity-60">
                            <BookOpen size={14} />
                            <span>《{p.bookTitle}》</span>
                          </div>
                          <span className="text-xs opacity-40">
                            {new Date(entry.viewedAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </span>
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
                  );
                })}
                <button
                  className="btn btn-ghost btn-sm mt-2"
                  onClick={() => {
                    setHistory([]);
                    localStorage.removeItem("rp-history");
                  }}
                >
                  清空历史记录
                </button>
              </div>
            )}
          </div>
        )}
        {tab === "inbox" && (
          <div className="w-full max-w-lg mx-auto">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Inbox size={20} />
              推送收件箱 · {pushInbox.length} 条
              {pushInbox.filter((p) => !p.readAt).length > 0 && (
                <span className="badge badge-primary badge-sm">
                  {pushInbox.filter((p) => !p.readAt).length} 未读
                </span>
              )}
            </h2>
            {!inboxLoaded ? (
              <div className="text-center py-12">
                <span className="loading loading-spinner loading-md"></span>
              </div>
            ) : pushInbox.length === 0 ? (
              <div className="text-center opacity-50 py-12">
                <Inbox size={48} className="mx-auto mb-4" />
                <p>还没有收到推送</p>
                <p className="text-sm mt-2">在「设置」中开启每日推送</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {pushInbox.map((item) => (
                  <div
                    key={item.id}
                    className={`card shadow-sm cursor-pointer ${item.readAt ? 'bg-base-200' : 'bg-base-200 border-l-4 border-primary'}`}
                    onClick={() => {
                      if (!item.readAt) markAsRead(item.id);
                      setPassage({
                        id: item.passageId,
                        text: item.text,
                        bookTitle: item.bookTitle,
                        author: item.author,
                        chapter: item.chapter,
                        tags: item.tags,
                        language: item.language,
                      });
                      setTab("discover");
                    }}
                  >
                    <div className="card-body p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm opacity-60">
                          <BookOpen size={14} />
                          <span>《{item.bookTitle}》</span>
                          {!item.readAt && <span className="badge badge-primary badge-xs">未读</span>}
                        </div>
                        <span className="text-xs opacity-40">
                          {new Date(item.sentAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="text-xs opacity-40">{item.author}</p>
                      <blockquote className="text-sm leading-relaxed border-l-2 border-primary pl-3 my-2 italic line-clamp-3">
                        &ldquo;{item.text}&rdquo;
                      </blockquote>
                      <div className="flex flex-wrap gap-1">
                        {item.tags.slice(0, 3).map((tag) => (
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
        {tab === "settings" && (
          <div className="w-full max-w-lg mx-auto space-y-6">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Settings size={20} />
              设置
            </h2>

            {/* Push Notifications */}
            <div className="card bg-base-200">
              <div className="card-body p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Bell size={20} />
                    <div>
                      <p className="font-medium">每日推送</p>
                      <p className="text-xs opacity-60">每天收到一段精选书籍片段</p>
                    </div>
                  </div>
                  {push.supported ? (
                    <input
                      type="checkbox"
                      className="toggle toggle-primary"
                      checked={push.subscribed}
                      disabled={push.loading}
                      onChange={() => push.subscribed ? push.unsubscribe() : push.subscribe()}
                    />
                  ) : (
                    <span className="badge badge-ghost text-xs">不支持</span>
                  )}
                </div>
              </div>
            </div>

            {/* Test Push */}
            {push.subscribed && (
              <div className="card bg-base-200">
                <div className="card-body p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">发送测试推送</p>
                      <p className="text-xs opacity-60">验证推送是否正常工作</p>
                    </div>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={async () => {
                        setTestPushStatus("发送中...");
                        try {
                          const res = await fetch("/api/push/test", { method: "POST" });
                          const data = await res.json();
                          if (res.ok) {
                            setTestPushStatus(`✅ 已发送 ${data.sent} 条`);
                          } else {
                            setTestPushStatus(`❌ ${data.error}`);
                          }
                        } catch {
                          setTestPushStatus("❌ 网络错误");
                        }
                        setTimeout(() => setTestPushStatus(null), 5000);
                      }}
                    >
                      测试
                    </button>
                  </div>
                  {testPushStatus && (
                    <p className="text-xs mt-2 opacity-70">{testPushStatus}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <nav className="btm-nav btm-nav-sm bg-base-200 pb-[env(safe-area-inset-bottom)]">
        <button className={tab === "discover" ? "active" : ""} onClick={() => setTab("discover")}>
          <Sparkles size={20} />
          <span className="btm-nav-label text-xs">发现</span>
        </button>
        <button className={tab === "inbox" ? "active" : ""} onClick={() => setTab("inbox")}>
          <div className="indicator">
            {pushInbox.filter((p) => !p.readAt).length > 0 && (
              <span className="indicator-item badge badge-primary badge-xs">
                {pushInbox.filter((p) => !p.readAt).length}
              </span>
            )}
            <Inbox size={20} />
          </div>
          <span className="btm-nav-label text-xs">收件箱</span>
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
