'use client';

import { createContext, useContext, useState, useEffect } from 'react';

type RoleContextType = {
    role: string;
    setRole: (role: string) => void;
};

const RoleContext = createContext<RoleContextType | undefined>(undefined);

export function RoleProvider({
    children,
    initialRole = 'guest'
}: {
    children: React.ReactNode,
    initialRole?: string
}) {
    const [role, setRole] = useState(initialRole);

    // Sync state if initialRole changes deeply (e.g. from server refresh)
    useEffect(() => {
        setRole(initialRole);
    }, [initialRole]);

    return (
        <RoleContext.Provider value={{ role, setRole }}>
            {children}
        </RoleContext.Provider>
    );
}

export function useUserRole() {
    const context = useContext(RoleContext);
    if (context === undefined) {
        throw new Error('useUserRole must be used within a RoleProvider');
    }
    return context;
}
