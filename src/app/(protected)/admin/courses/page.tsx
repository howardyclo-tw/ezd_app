import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus, Upload } from "lucide-react";

export default function CoursesPage() {
    return (
        <div className="container py-10">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">課程管理</h1>
                    <p className="text-muted-foreground">管理所有的舞蹈課程</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                    <Button variant="outline" className="w-full sm:w-auto">
                        <Upload className="mr-2 h-4 w-4" />
                        批次匯入
                    </Button>
                    <Link href="/admin/courses/new" className="w-full sm:w-auto">
                        <Button className="w-full">
                            <Plus className="mr-2 h-4 w-4" />
                            新增課程
                        </Button>
                    </Link>
                </div>
            </div>

            <div className="rounded-md border p-8 text-center text-muted-foreground">
                目前沒有課程，點擊上方按鈕新增課程。
            </div>
        </div>
    );
}
