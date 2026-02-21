'use client';

import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { HelpCircle, Info } from 'lucide-react';

export function MakeupQuotaInfo() {
    return (
        <div
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
            onPointerDown={(e) => {
                e.stopPropagation();
            }}
            className="flex items-center justify-center cursor-pointer"
        >
            <Popover>
                <PopoverTrigger asChild>
                    <div
                        role="button"
                        tabIndex={0}
                        className="text-muted-foreground/40 hover:text-primary transition-colors flex items-center justify-center h-6 w-6 rounded-full hover:bg-muted/10"
                    >
                        <HelpCircle className="h-3.5 w-3.5" />
                    </div>
                </PopoverTrigger>
                <PopoverContent
                    className="w-64 p-4 rounded-xl shadow-xl border-muted/20 z-[100]"
                    align="center"
                    sideOffset={8}
                >
                    <div className="space-y-2">
                        <h4 className="font-bold text-xs flex items-center gap-2">
                            <Info className="h-3.5 w-3.5 text-primary" />
                            補課額度說明
                        </h4>
                        <p className="text-[11px] leading-relaxed text-muted-foreground font-medium">
                            補課額度僅限於<span className="text-primary font-bold">同一期 (Course Group)</span> 內使用。
                            當您在該期課程中有請假或缺席紀錄時，可於同期的其他班級申請補課。
                        </p>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
