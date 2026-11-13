/* What the Tickets view shows before it has a ticket to show: the first
   load, a load that failed with nothing cached, and a repo with no logs. */
type StatusProps = {
  kind: "loading" | "failed" | "empty";
  root: string | null;
  host: string;
  onRetry(): void;
  onNewTask(): void;
  onBootstrap(opener: HTMLElement): void;
};

function StatusPage({kind, root, host, onRetry, onNewTask, onBootstrap}: StatusProps){
  const where = root ? root + "/.adp/" : ".adp/";
  // The auto margin centers the page in the stage the way the boards draw
  // it, and a page taller than the stage still scrolls from its top.
  return <div className="adp-empty" id="statusPage" data-status={kind} style={{margin: "auto"}}>
    {kind === "loading" ? <>
      <p className="adp-label">Loading</p>
      <h1 className="adp-empty__title" role="status" style={{marginTop: 8}}>Building the index from the working tree</h1>
      <p className="adp-empty__text">Tickets, watches and the ledger appear together as soon as it is ready.</p>
      <p className="adp-empty__path">Reading {where}</p>
    </> : kind === "failed" ? <>
      <h1 className="adp-empty__title" role="status">Can’t reach Mission Control’s server</h1>
      <p className="adp-empty__text">The page opened, but the server on {host} stopped answering before the index arrived.
        Nothing is cached yet, so there is nothing to show.</p>
      <p className="adp-empty__text">Mission Control keeps trying. If the server stopped, run the launcher in this repo again.</p>
      <div className="adp-empty__actions">
        <button type="button" className="adp-btn adp-btn--primary" id="retryBtn" onClick={onRetry}>Retry now</button>
      </div>
      <p className="adp-empty__path">Watching {where}</p>
    </> : <>
      <div className="adp-empty__mark" aria-hidden="true">◢◣◤◥</div>
      <h1 className="adp-empty__title">No audit logs in this repo yet</h1>
      <p className="adp-empty__text">Mission Control reads <code className="adp-code">.adp/</code> in the working tree. Start a task and its log shows up here as soon as the first phase is written.</p>
      <div className="adp-empty__actions">
        <button type="button" className="adp-btn adp-btn--primary" onClick={onNewTask}>+ New task</button>
        <button type="button" className="adp-btn adp-btn--text" onClick={e => onBootstrap(e.currentTarget)}>Bootstrap pack ›</button>
      </div>
      <p className="adp-empty__path">Watching {where}</p>
    </>}
  </div>;
}

export {StatusPage};
