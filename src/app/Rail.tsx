import {Fragment} from "react";
import type {RailEntry, RailModelGroup} from "../lib/adp-shell-lib.ts";

type RailProps = {
  groups: RailModelGroup[];
  selKey: string | null;
  collapsed: ReadonlySet<string>;
  onPick(key: string): void;
  onToggle(name: string): void;
};

function Ribbon({ribbon}: Pick<RailEntry, "ribbon">){
  return <span className="rrib">
    {ribbon.reasons.map((r, i) => <Fragment key={i}>{i ? " · " : null}<span className={"r-" + r.tone}>{r.txt}</span></Fragment>)}
    {ribbon.more ? <> <span className="rmore">+{ribbon.more}</span></> : null}
  </span>;
}

/* The rail lists the corpus tickets by group. A section header takes no
   place in the tab order, but its tabindex lets the page hand it focus. */
function Rail({groups, selKey, collapsed, onPick, onToggle}: RailProps){
  return <aside className="rail" id="rail">
    {groups.map(([name, list]) => {
      const closed = collapsed.has(name);
      return <Fragment key={name}>
        <div className="railsec" data-sec={name} tabIndex={-1} onClick={() => onToggle(name)}>
          <span><span className="rcv">{closed ? "▸" : "▾"}</span><span className="rname">{name}</span></span>
          <b className="rcount">{list.length}</b>
        </div>
        {closed ? null : list.map(e => <div className="rrow" key={e.key}>
          <button type="button" className={"rentry" + (e.key === selKey ? " is-sel" : "")} data-key={e.key} onClick={() => onPick(e.key)}>
            <span className="rid">{e.id}{e.date ? <> <span className="rdate">· {e.date}</span></> : null}</span>
            <span className="rslug">{e.slug}</span>
            <Ribbon ribbon={e.ribbon}/>
          </button>
        </div>)}
      </Fragment>;
    })}
  </aside>;
}

export {Rail};
