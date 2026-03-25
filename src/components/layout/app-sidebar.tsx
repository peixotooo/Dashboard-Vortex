"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  LayoutDashboard,
  Megaphone,
  LineChart,
  ShoppingBag,
  Users,
  Image,
  BookOpen,
  Settings,
  Zap,
  MessageSquare,
  MessageCircle,
  KanbanSquare,
  FileOutput,
  CircleDollarSign,
  Calculator,
  CalendarDays,
  Landmark,
  SlidersHorizontal,
  Search,
  TrendingUp,
  Boxes,
  Contact,
  LayoutGrid,
  Gift,
  LogOut,
  ChevronsUpDown,
  ArrowLeftRight,
  Package,
  ShoppingCart,
  FileText,
  Tag,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useWorkspace } from "@/lib/workspace-context";
import { canAccessPath } from "@/lib/features";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type NavSubItem = {
  title: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
};

type NavItem = {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  items?: NavSubItem[];
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: "Principal",
    items: [
      { title: "Overview", href: "/", icon: LayoutDashboard },
      {
        title: "Time",
        href: "/team",
        icon: Users,
        items: [
          { title: "Chat", href: "/team/chat", icon: MessageSquare },
          { title: "Kanban", href: "/team/kanban", icon: KanbanSquare },
          { title: "Entregas", href: "/team/deliverables", icon: FileOutput },
          { title: "Planejamento", href: "/team/planning", icon: CalendarDays },
        ],
      },
      { title: "Vortex IA", href: "/agent", icon: Zap },
    ],
  },
  {
    label: "Marketing",
    items: [
      {
        title: "Meta Ads",
        href: "/campaigns",
        icon: Megaphone,
        items: [
          { title: "Campanhas", href: "/campaigns" },
          { title: "Audiencias", href: "/audiences" },
          { title: "Criativos", href: "/creatives" },
        ],
      },
      { title: "Google Ads", href: "/google-ads", icon: CircleDollarSign },
      { title: "Google Analytics", href: "/ga4", icon: LineChart },
    ],
  },
  {
    label: "Loja",
    items: [
      {
        title: "Loja",
        href: "/vnda",
        icon: ShoppingBag,
        items: [
          { title: "Produtos", href: "/products", icon: Boxes },
          { title: "Prateleiras", href: "/shelves", icon: LayoutGrid },
          { title: "Régua de Brinde", href: "/gift-bar", icon: Gift },
          { title: "Etiquetas Promo", href: "/promo-tags", icon: Tag },
        ],
      },
      {
        title: "CRM",
        href: "/crm",
        icon: Contact,
        items: [
          { title: "CRM", href: "/crm", icon: Contact },
          { title: "WhatsApp", href: "/crm/whatsapp", icon: MessageCircle },
          { title: "WhatsApp Grupos", href: "/whatsapp-groups", icon: Users },
        ],
      },
    ],
  },
  {
    label: "Hub",
    items: [
      {
        title: "Hub ML",
        href: "/hub",
        icon: ArrowLeftRight,
        items: [
          { title: "Dashboard", href: "/hub", icon: LayoutDashboard },
          { title: "Produtos", href: "/hub/produtos", icon: Package },
          { title: "Pedidos", href: "/hub/pedidos", icon: ShoppingCart },
          { title: "Logs", href: "/hub/logs", icon: FileText },
        ],
      },
    ],
  },
  {
    label: "Financeiro",
    items: [
      {
        title: "Financeiro",
        href: "/simulador",
        icon: Landmark,
        items: [
          { title: "Simulador", href: "/simulador", icon: Calculator },
          { title: "Diagnostico", href: "/simulador/diagnostico", icon: Search },
          { title: "Escala", href: "/simulador/escala", icon: TrendingUp },
          {
            title: "Configuracoes",
            href: "/simulador/config",
            icon: SlidersHorizontal,
          },
        ],
      },
    ],
  },
  {
    label: "Conteudo",
    items: [
      { title: "Galeria", href: "/media", icon: Image },
      { title: "Brandbook", href: "/brandbook", icon: BookOpen },
    ],
  },
];

function NavCollapsible({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const isChildActive = item.items?.some(
    (sub) =>
      pathname === sub.href ||
      (sub.href !== "/" && pathname.startsWith(sub.href))
  );

  const isActive =
    pathname === item.href ||
    (item.href !== "/" && pathname.startsWith(item.href));

  return (
    <Collapsible
      asChild
      defaultOpen={isActive || isChildActive}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          tooltip={item.title}
          isActive={isActive || isChildActive}
        >
          <div className="flex w-full items-center justify-between">
            <Link 
              href={item.href} 
              className={cn(
                "flex items-center gap-2 overflow-hidden transition-all duration-200",
                isCollapsed ? "w-0 flex-1 justify-center" : "flex-1"
              )}
            >
              <item.icon className="shrink-0" />
              <span className={cn(
                "truncate transition-opacity duration-200",
                isCollapsed ? "opacity-0 w-0" : "opacity-100"
              )}>
                {item.title}
              </span>
            </Link>
            {!isCollapsed && (
              <CollapsibleTrigger asChild>
                <button className="flex h-full items-center justify-center px-1">
                  <ChevronRight className="transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </button>
              </CollapsibleTrigger>
            )}
          </div>
        </SidebarMenuButton>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.items?.map((sub) => {
              const subActive =
                pathname === sub.href ||
                (sub.href !== "/" && pathname.startsWith(sub.href));
              return (
                <SidebarMenuSubItem key={sub.href}>
                  <SidebarMenuSubButton asChild isActive={subActive}>
                    <Link href={sub.href}>
                      {sub.icon && <sub.icon />}
                      <span>{sub.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function NavSingle({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  
  const isActive =
    pathname === item.href ||
    (item.href !== "/" && pathname.startsWith(item.href));

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
        <Link 
          href={item.href} 
          className={cn(
            "flex items-center gap-2 overflow-hidden transition-all duration-200",
            isCollapsed && "justify-center"
          )}
        >
          <item.icon className="shrink-0" />
          <span className={cn(
            "truncate transition-opacity duration-200",
            isCollapsed ? "opacity-0 w-0" : "opacity-100"
          )}>
            {item.title}
          </span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function NavUser() {
  const { user, signOut } = useAuth();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const initials = React.useMemo(() => {
    if (!user?.email) return "U";
    return user.email
      .split("@")[0]
      .slice(0, 2)
      .toUpperCase();
  }, [user?.email]);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className={cn(
                "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground transition-all duration-200",
                isCollapsed && "justify-center px-0"
              )}
            >
              <Avatar className="h-8 w-8 shrink-0 rounded-lg">
                <AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-xs">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {!isCollapsed && (
                <>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {user?.email?.split("@")[0] ?? "Usuario"}
                    </span>
                    <span className="truncate text-xs text-sidebar-foreground/60">
                      {user?.email ?? ""}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </>
              )}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side="bottom"
            align="end"
            sideOffset={4}
          >
            <DropdownMenuItem asChild>
              <Link href="/settings" className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                Configuracoes
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { userRole, userFeatures } = useWorkspace();

  const filteredNavGroups = React.useMemo(() => {
    return navGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          canAccessPath(item.href, userRole, userFeatures)
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [userRole, userFeatures]);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className={isCollapsed ? "justify-center px-0" : ""}>
              <Link href="/">
                <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Zap className="size-4" />
                </div>
                {!isCollapsed && (
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">Vortex</span>
                    <span className="truncate text-xs text-sidebar-foreground/60">
                      Dashboard
                    </span>
                  </div>
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {filteredNavGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) =>
                  item.items && item.items.length > 0 ? (
                    <NavCollapsible key={item.title} item={item} />
                  ) : (
                    <NavSingle key={item.title} item={item} />
                  )
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
