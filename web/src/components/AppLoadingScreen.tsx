export default function AppLoadingScreen() {
  return (
    <div role="status" aria-busy="true" className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-slate-400">로딩중...</div>
    </div>
  );
}
