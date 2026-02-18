'use client';

import { createContext, useContext, useState, useEffect } from 'react';

type RoleContextType = {
    role: string;
    userName: string;
    setRole: (role: string) => void;
    setUserName: (name: string) => void;
};

const RoleContext = createContext<RoleContextType | undefined>(undefined);

export function RoleProvider({
    children,
    initialRole = 'guest',
    initialName = ''
}: {
    children: React.ReactNode,
    initialRole?: string,
    initialName?: string
}) {
    const [role, setRole] = useState(initialRole);
    const [userName, setUserName] = useState(initialName);

    // Sync state if initialRole or initialName changes deeply (e.g. from server refresh)
    useEffect(() => {
        setRole(initialRole);
        setUserName(initialName);
    }, [initialRole, initialName]);

    return (
        <RoleContext.Provider value={{ role, userName, setRole, setUserName }}>
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
