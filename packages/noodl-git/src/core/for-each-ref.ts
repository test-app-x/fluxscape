import { git } from "./client";
import { GitError } from "dugite";
import {
  Branch,
  BranchType,
  IBranchTip,
  ITrackingBranch,
} from "./models/branch";
import { CommitIdentity } from "./models/commit-identity";
import { createForEachRefParser } from "./git-delimiter-parser";

/** Get all the branches. */
export async function getBranches(
  repositoryDir: string,
  ...prefixes: string[]
): Promise<ReadonlyArray<Branch>> {
  const { formatArgs, parse } = createForEachRefParser({
    fullName: "%(refname)",
    shortName: "%(refname:short)",
    upstreamShortName: "%(upstream:short)",
    sha: "%(objectname)",
    author: "%(author)",
    symRef: "%(symref)",
  });

  if (!prefixes || !prefixes.length) {
    prefixes = ["refs/heads", "refs/remotes"];
  }

  const result = await git(
    ["for-each-ref", ...formatArgs, ...prefixes],
    repositoryDir,
    "getBranches",
    {
      expectedErrors: new Set([GitError.NotAGitRepository]),
    }
  );

  if (result.gitError === GitError.NotAGitRepository) {
    return [];
  }

  const allBranches: Branch[] = [];

  const parsedLines = parse(result.output.toString());
  for (const ref of parsedLines) {
    // excude symbolic refs from the branch list
    if (ref.symRef.length > 0) {
      continue;
    }

    const author = CommitIdentity.parseIdentity(ref.author);
    const tip: IBranchTip = { sha: ref.sha, author };

    const type = ref.fullName.startsWith("refs/heads")
      ? BranchType.Local
      : BranchType.Remote;

    const upstream =
      ref.upstreamShortName.length > 0 ? ref.upstreamShortName : null;

    allBranches.push(
      new Branch(ref.shortName, upstream, tip, type, ref.fullName)
    );
  }

  // Combine into one array where "Branch.remote" will be the remote branch if it exists.
  const branches: Branch[] = [];

  for (const branch of allBranches) {
    const index = branches.findIndex((x) => x.upstream == branch.name);

    if (index !== -1) {
      branches[index] =
        branch.type === BranchType.Local
          ? branch.withRemote(branches[index])
          : branches[index].withRemote(branch);
    } else {
      branches.push(branch);
    }
  }

  return branches;
}

/** Get all the branches. */
export async function getBranchesOld(
  repositoryDir: string,
  ...prefixes: string[]
): Promise<ReadonlyArray<Branch>> {
  const { formatArgs, parse } = createForEachRefParser({
    fullName: "%(refname)",
    shortName: "%(refname:short)",
    upstreamShortName: "%(upstream:short)",
    sha: "%(objectname)",
    author: "%(author)",
    symRef: "%(symref)",
  });

  if (!prefixes || !prefixes.length) {
    prefixes = ["refs/heads", "refs/remotes"];
  }

  const result = await git(
    ["for-each-ref", ...formatArgs, ...prefixes],
    repositoryDir,
    "getBranches",
    {
      expectedErrors: new Set([GitError.NotAGitRepository]),
    }
  );

  if (result.gitError === GitError.NotAGitRepository) {
    return [];
  }

  const allBranches: Branch[] = [];

  const parsedLines = parse(result.output.toString());
  for (const ref of parsedLines) {
    // excude symbolic refs from the branch list
    if (ref.symRef.length > 0) {
      continue;
    }

    const author = CommitIdentity.parseIdentity(ref.author);
    const tip: IBranchTip = { sha: ref.sha, author };

    const type = ref.fullName.startsWith("refs/heads")
      ? BranchType.Local
      : BranchType.Remote;

    const upstream =
      ref.upstreamShortName.length > 0 ? ref.upstreamShortName : null;

    allBranches.push(
      new Branch(ref.shortName, upstream, tip, type, ref.fullName)
    );
  }

  return allBranches;
}

/**
 * Gets all branches that differ from their upstream (i.e. they're ahead,
 * behind or both), excluding the current branch.
 * Useful to narrow down a list of branches that could potentially be fast
 * forwarded.
 *
 * @param repositoryDir Repository to get the branches from.
 */
export async function getBranchesDifferingFromUpstream(
  repositoryDir: string
): Promise<ReadonlyArray<ITrackingBranch>> {
  const { formatArgs, parse } = createForEachRefParser({
    fullName: "%(refname)",
    sha: "%(objectname)", // SHA
    upstream: "%(upstream)",
    symref: "%(symref)",
    head: "%(HEAD)",
  });

  const prefixes = ["refs/heads", "refs/remotes"];

  const result = await git(
    ["for-each-ref", ...formatArgs, ...prefixes],
    repositoryDir,
    "getBranchesDifferingFromUpstream",
    { expectedErrors: new Set([GitError.NotAGitRepository]) }
  );

  if (result.gitError === GitError.NotAGitRepository) {
    return [];
  }

  const localBranches = [];
  const remoteBranchShas = new Map<string, string>();

  // First we need to collect the relevant info from the command output:
  // - For local branches with upstream: name, ref, SHA and the upstream.
  // - For remote branches we only need the sha (and the ref as key).
  for (const ref of parse(result.output.toString())) {
    if (ref.symref.length > 0 || ref.head === "*") {
      // Exclude symbolic refs and the current branch
      continue;
    }

    if (ref.fullName.startsWith("refs/heads")) {
      if (ref.upstream.length === 0) {
        // Exclude local branches without upstream
        continue;
      }

      localBranches.push({
        ref: ref.fullName,
        sha: ref.sha,
        upstream: ref.upstream,
      });
    } else {
      remoteBranchShas.set(ref.fullName, ref.sha);
    }
  }

  const eligibleBranches = new Array<ITrackingBranch>();

  // Compare the SHA of every local branch with the SHA of its upstream and
  // collect the names of local branches that differ from their upstream.
  for (const branch of localBranches) {
    const remoteSha = remoteBranchShas.get(branch.upstream);

    if (remoteSha !== undefined && remoteSha !== branch.sha) {
      eligibleBranches.push({
        ref: branch.ref,
        sha: branch.sha,
        upstreamRef: branch.upstream,
        upstreamSha: remoteSha,
      });
    }
  }

  return eligibleBranches;
}
