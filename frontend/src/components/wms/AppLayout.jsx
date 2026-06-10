import { WmsHeader } from "./Header";
import { WmsSidebar } from "./Sidebar";

function AppLayout({ children }) {
  return (
    <div className="h-screen overflow-hidden flex flex-col bg-background">
      <WmsHeader />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <WmsSidebar />
        <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

export {
  AppLayout
};
