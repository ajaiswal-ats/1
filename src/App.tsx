import { CandidatePage } from "./candidates/CandidatePage";
import { Candidates } from "./candidates/Candidates";
import { Sidebar } from "./components/Sidebar";
import { Tooltip } from "./components/Tooltip";
import { TopBar } from "./components/TopBar";
import { navFor, useHashRoute } from "./lib/route";
import { HiringProgress } from "./progress/HiringProgress";
import { RolePage } from "./roles/RolePage";
import { Roles } from "./roles/Roles";

export function App() {
  const route = useHashRoute(), current = navFor(route);
  return (
    <>
      <div className="shell">
        <Sidebar current={current} />
        <div className="main">
          <TopBar />
          <main className="page" id="page" tabIndex={-1}>
            {route.startsWith("c-") ? <CandidatePage key={route} id={route.slice(2)} />
              : current === "progress" ? <HiringProgress />
              : route.startsWith("role-") ? <RolePage id={route.slice(5)} />
              : current === "roles" ? <Roles />
              : <Candidates />}
          </main>
        </div>
      </div>
      <Tooltip />
    </>
  );
}
