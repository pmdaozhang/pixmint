// 金色会员皇冠图标（32×32 PNG），用于托盘菜单里的「终身会员」项。
const PRO_CROWN_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACC0lEQVR42mNgGAWjgEwgK8Kkn+jEMR+EQWy6O2BxpfL7z5dr/4MwiE1Xy9WlmO1PLXL//+NmAxiD2CAx+oZAhdL7TxdK/4MwiE01g600WONX1Km/B2EQG18amF+hdr8ujPs8vjRArHlwsKJO7f3XSyX/QRjExqVOmJdRfu9Ek/87unX/g9iUmofQUKv6/suFgv8gDGLjUpftybn+5eGU/yAMygmUmocaZECFIIwryEAJ7vgc2/+fz+WA8aFp5jgTITHmYQULC4X/49JQFSaw/+3RpP+fz2SAMYgNEsPlAJBZJCfG47Ms/+/p0/tvoMjij27gmQV2/z+dSkHBIPXoakF8kBkgOZIdcGym+f+PxxP+LyqVeY+cyidnit0HiWPDIDnkXALSCxIHmUW6A2aY/v9wNOb/q/3hQEdIgx3hZ8pef3WlM1gcG76w2O6/ix5bPsRy6fcgvSBxkFkkO+DodOP/7w9HgPHLvcH/19SrvN/YqvEeJoYLg9SA1IL0wMRAZpHugGmG/98dDKEKBplFsgOOTNX//3Z/AFUwyCzSHTBF9/+bvT5UwSCzSHbA4cna/1/v9qAKBplFugMmav5/tcOFKhhkFskOODRB/f/LbQ5UwSCzSHdAv+r/F1tsqIJBZpHsgIN9yv+fb7KgCgaZRboDehX/P9tgQhUMMotkB4CKXWri0X7EKBi0AAA6YGMxYQ+LsQAAAABJRU5ErkJggg=='

export function proIconDataUrl(): string {
  return `data:image/png;base64,${PRO_CROWN_PNG}`
}
