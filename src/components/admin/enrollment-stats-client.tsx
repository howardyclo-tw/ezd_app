'use client';

import { useState, useTransition } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, BarChart3, ClipboardCopy, Check } from 'lucide-react';
import { getEnrollmentStats, type CourseStatsRow } from '@/lib/supabase/stats-actions';

interface GroupOption {
  id: string;
  title: string;
  periodEnd: string | null;
}

interface CourseOption {
  id: string;
  groupId: string;
  name: string;
  teacher: string;
}

interface Props {
  groups: GroupOption[];
  courses: CourseOption[];
}

export function EnrollmentStatsClient({ groups, courses }: Props) {
  const [selectedGroup, setSelectedGroup] = useState(groups[0]?.id ?? '');
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(() => {
    const initial = courses.filter((c) => c.groupId === groups[0]?.id).map((c) => c.id);
    return new Set(initial);
  });
  const [results, setResults] = useState<CourseStatsRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const groupCourses = courses.filter((c) => c.groupId === selectedGroup);
  const allSelected = groupCourses.length > 0 && groupCourses.every((c) => selectedCourses.has(c.id));

  function handleGroupChange(groupId: string) {
    setSelectedGroup(groupId);
    setSelectedCourses(new Set(courses.filter((c) => c.groupId === groupId).map((c) => c.id)));
    setResults(null);
  }

  function toggleCourse(courseId: string) {
    setSelectedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedCourses(new Set());
    } else {
      setSelectedCourses(new Set(groupCourses.map((c) => c.id)));
    }
  }

  const [copied, setCopied] = useState(false);

  function buildCsvText() {
    if (!results || results.length === 0) return '';
    const header =
      '課程,老師,容量,社員整期,堂卡(社員)不重複人數,堂卡(社員)報名次數,堂卡(非社員)不重複人數,堂卡(非社員)報名次數,社員補課不重複人數,社員補課次數';
    const rows = results.map((r) =>
      [r.courseName, r.teacher, r.capacity, r.fullCount, r.memberSingleUniq, r.memberSingleCount, r.guestSingleUniq, r.guestSingleCount, r.makeupUniq, r.makeupCount].join(',')
    );
    return header + '\n' + rows.join('\n');
  }

  async function copyCsv() {
    const text = buildCsvText();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleQuery() {
    const ids = Array.from(selectedCourses);
    if (ids.length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const data = await getEnrollmentStats(ids);
        setResults(data);
      } catch (e: any) {
        setError(e.message ?? '查詢失敗');
      }
    });
  }

  return (
    <div className="flex h-[calc(100dvh-9.5rem)] flex-col gap-4 md:h-[calc(100dvh-5.5rem)]">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold">報名統計</h1>
        <p className="text-xs text-muted-foreground">各課程整期 / 堂卡 / 補課人數統計（僅幹部）</p>
      </div>

      {/* Filters */}
      <div className="space-y-3 rounded-xl border border-white/10 bg-[#1A1A1C]/40 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <label className="mb-1 block text-xs text-muted-foreground">期別</label>
            <Select value={selectedGroup} onValueChange={handleGroupChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleQuery} disabled={pending || selectedCourses.size === 0} size="sm">
            {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="mr-1.5 h-3.5 w-3.5" />}
            查詢
          </Button>
          <Button
            onClick={copyCsv}
            disabled={!results || results.length === 0}
            size="sm"
            variant="outline"
          >
            {copied ? <Check className="mr-1.5 h-3.5 w-3.5 text-green-400" /> : <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" />}
            {copied ? '已複製' : '複製 CSV'}
          </Button>
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <label className="text-xs text-muted-foreground">課程</label>
            <button onClick={toggleAll} className="text-xs text-primary hover:underline">
              {allSelected ? '取消全選' : '全選'}
            </button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {groupCourses.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={selectedCourses.has(c.id)}
                  onCheckedChange={() => toggleCourse(c.id)}
                />
                <span>
                  {c.name}
                  <span className="text-muted-foreground"> ({c.teacher})</span>
                </span>
              </label>
            ))}
            {groupCourses.length === 0 && (
              <p className="text-xs text-muted-foreground">此期別尚無課程</p>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {results && (
        <div className="flex-1 overflow-auto rounded-xl border border-white/10 bg-[#1A1A1C]/40">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-[#1A1A1C] z-10">課程</TableHead>
                <TableHead>老師</TableHead>
                <TableHead className="text-center">容量</TableHead>
                <TableHead className="text-center">社員整期</TableHead>
                <TableHead className="text-center whitespace-nowrap">
                  <div>堂卡(社員)</div>
                  <div className="text-[10px] font-normal text-muted-foreground">不重複人數 / 報名次數</div>
                </TableHead>
                <TableHead className="text-center whitespace-nowrap">
                  <div>堂卡(非社員)</div>
                  <div className="text-[10px] font-normal text-muted-foreground">不重複人數 / 報名次數</div>
                </TableHead>
                <TableHead className="text-center whitespace-nowrap">
                  <div>社員補課</div>
                  <div className="text-[10px] font-normal text-muted-foreground">不重複人數 / 補課次數</div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.courseId}>
                  <TableCell className="sticky left-0 bg-[#1A1A1C] z-10 font-medium">{r.courseName}</TableCell>
                  <TableCell>{r.teacher}</TableCell>
                  <TableCell className="text-center">{r.capacity}</TableCell>
                  <TableCell className="text-center">{r.fullCount}</TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    {r.memberSingleCount > 0
                      ? `${r.memberSingleUniq}人 / ${r.memberSingleCount}次`
                      : '-'}
                  </TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    {r.guestSingleCount > 0
                      ? `${r.guestSingleUniq}人 / ${r.guestSingleCount}次`
                      : '-'}
                  </TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    {r.makeupCount > 0
                      ? `${r.makeupUniq}人 / ${r.makeupCount}次`
                      : '-'}
                  </TableCell>
                </TableRow>
              ))}
              {results.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    無資料
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {!results && !error && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-muted-foreground">
            <BarChart3 className="mx-auto mb-2 h-8 w-8 opacity-40" />
            <p className="text-sm">選擇期別與課程後按「查詢」</p>
          </div>
        </div>
      )}
    </div>
  );
}
