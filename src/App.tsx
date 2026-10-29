import { DemoExit } from "./components/DemoExit";
import { DemoHelp } from "./help/HelpPage";
import { CandidatePage } from "./candidates/CandidatePage";
import { Candidates } from "./candidates/Candidates";
import { NavScrim, useNavDrawer } from "./components/NavDrawer";
import { Sidebar } from "./components/Sidebar";
import { Tooltip } from "./components/Tooltip";
import { TopBar } from "./components/TopBar";
import { isCandidatesList, navFor, useHashRoute } from "./lib/route";
import { HiringProgress } from "./progress/HiringProgress";
import { RolePage } from "./roles/RolePage";
import { Roles } from "./roles/Roles";

export function App() {
  const route = useHashRoute(), current = navFor(route), drawer = useNavDrawer();
  if(route==="demo-exit") return <DemoExit/>;
  return (
    <>
      <div className={drawer.open ? "shell nav-open" : "shell"}>
        <Sidebar current={current} />
        <NavScrim drawer={drawer} />
        <div className="main">
          <TopBar drawer={drawer} />
          <main className={isCandidatesList(route) ? "page pg-cands" : "page"} id="page" tabIndex={-1}>
            {route==="help" ? <DemoHelp /> : route.startsWith("c-") ? <CandidatePage key={route} id={route.slice(2)} />
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
