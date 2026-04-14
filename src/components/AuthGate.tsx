"use client";

import { useState, useEffect } from "react";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import { KeyRound, UserPlus, LogIn, Globe } from "lucide-react";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [userName, setUserName] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data) => {
        setAuthenticated(data.authenticated);
        if (data.user) setUserName(data.user.displayName);
      })
      .catch(() => setAuthenticated(false));
  }, []);

  const handleRegister = async () => {
    if (!displayName.trim()) {
      setError("请输入显示名称");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const optRes = await fetch("/api/auth/register/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      const { options, userId, error: optError } = await optRes.json();
      if (optError) throw new Error(optError);

      const credential = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, credential, displayName: displayName.trim() }),
      });
      const result = await verifyRes.json();
      if (result.verified) {
        setAuthenticated(true);
        setUserName(displayName.trim());
      } else {
        throw new Error(result.error || "注册失败");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "注册失败");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    setError("");
    try {
      const optRes = await fetch("/api/auth/login/options", { method: "POST" });
      const { options, challengeId, error: optError } = await optRes.json();
      if (optError) throw new Error(optError);

      const credential = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, credential }),
      });
      const result = await verifyRes.json();
      if (result.verified) {
        setAuthenticated(true);
        // Refresh to get user name
        const sess = await fetch("/api/auth/session").then((r) => r.json());
        if (sess.user) setUserName(sess.user.displayName);
      } else {
        throw new Error(result.error || "登录失败");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  // Loading state
  if (authenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  // Authenticated — render app
  if (authenticated) {
    return <>{children}</>;
  }

  // Auth form
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="card bg-base-200 shadow-xl max-w-sm w-full">
        <div className="card-body items-center text-center">
          <KeyRound size={48} className="text-primary mb-2" />
          <h2 className="card-title">📖 RandomPage</h2>
          <p className="text-sm opacity-60 mb-4">使用 Passkey 安全登录</p>

          {error && (
            <div className="alert alert-error text-sm mb-2">
              <span>{error}</span>
            </div>
          )}

          {mode === "register" ? (
            <>
              <input
                type="text"
                placeholder="你的名字"
                className="input input-bordered w-full"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRegister()}
              />
              <button
                className="btn btn-primary w-full mt-2"
                onClick={handleRegister}
                disabled={loading}
              >
                {loading ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <UserPlus size={16} />
                )}
                注册
              </button>
              <button
                className="btn btn-ghost btn-sm mt-2"
                onClick={() => { setMode("login"); setError(""); }}
              >
                已有账号？登录
              </button>
            </>
          ) : (
            <>
              <button
                className="btn btn-primary w-full"
                onClick={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <LogIn size={16} />
                )}
                登录
              </button>
              <button
                className="btn btn-ghost btn-sm mt-2"
                onClick={() => { setMode("register"); setError(""); }}
              >
                没有账号？注册
              </button>

              <div className="divider text-xs opacity-50">或</div>

              <a
                href="/api/logto/sign-in"
                className="btn btn-outline btn-secondary w-full"
              >
                <Globe size={16} />
                使用 Logto 登录
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
