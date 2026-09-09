package main

import (
    "encoding/json"
    "errors"
    "fmt"
    "log"
    "net/http"
    "net/url"
    "os"
    "strconv"
    "strings"

    "github.com/elboletaire/manga-downloader/grabber"
)

type result struct {
    Source string `json:"source"`
    Title  string `json:"title"`
    URL    string `json:"url"`
    Access string `json:"access"`
}

type chapter struct {
    Index    int     `json:"index"`
    Number   float64 `json:"number"`
    Title    string  `json:"title"`
    Language string  `json:"language,omitempty"`
    Access   string  `json:"access"`
}

type page struct {
    Number int64  `json:"number"`
    URL    string `json:"url"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
    w.Header().Set("Content-Type", "application/json; charset=utf-8")
    w.Header().Set("Access-Control-Allow-Origin", "*")
    w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
    w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
    w.WriteHeader(status)
    _ = json.NewEncoder(w).Encode(v)
}

func settings(language string) *grabber.Settings {
    return &grabber.Settings{
        Language: language,
        Scanlator: "",
        Format: "raw",
        ConvertImages: "none",
        MaxConcurrency: grabber.MaxConcurrency{Chapters: 1, Pages: 10},
        Retry: 1,
        BrowserVisible: false,
    }
}

func newSite(rawURL, language string) (grabber.Site, []error, error) {
    u, err := url.Parse(rawURL)
    if err != nil || u.Scheme != "http" && u.Scheme != "https" || u.Host == "" {
        return nil, nil, errors.New("invalid manga URL")
    }
    site, errs := grabber.NewSite(rawURL, settings(language))
    if site == nil {
        return nil, errs, errors.New("unsupported manga source")
    }
    return site, errs, nil
}

func sourceName(site grabber.Site) string {
    host := site.BaseUrl()
    if u, err := url.Parse(host); err == nil {
        return u.Hostname()
    }
    return host
}

func handleSource(w http.ResponseWriter, r *http.Request) {
    raw := r.URL.Query().Get("url")
    if raw == "" {
        writeJSON(w, 400, map[string]any{"error": "missing url"})
        return
    }
    language := r.URL.Query().Get("language")
    site, identifyErrors, err := newSite(raw, language)
    if err != nil {
        writeJSON(w, 400, map[string]any{"error": err.Error(), "identifyErrors": identifyErrors})
        return
    }

    title, err := site.FetchTitle()
    if err != nil {
        writeJSON(w, 502, map[string]any{"error": "failed to fetch title", "details": err.Error()})
        return
    }
    chaps, fetchErrors := site.FetchChapters()
    out := make([]chapter, 0, len(chaps))
    for i, c := range chaps {
        language := ""
        if x, ok := c.(interface{ GetLanguage() string }); ok {
            language = x.GetLanguage()
        }
        out = append(out, chapter{
            Index: i, Number: c.GetNumber(), Title: c.GetTitle(), Language: language,
            Access: fmt.Sprintf("/chapter?url=%s&index=%d&language=%s", url.QueryEscape(raw), i, url.QueryEscape(language)),
        })
    }

    writeJSON(w, 200, map[string]any{
        "source": sourceName(site), "title": title, "url": raw,
        "chapters": out, "identifyErrors": identifyErrors, "fetchErrors": errorsToStrings(fetchErrors),
    })
}

func handleChapter(w http.ResponseWriter, r *http.Request) {
    raw := r.URL.Query().Get("url")
    if raw == "" { writeJSON(w, 400, map[string]any{"error": "missing url"}); return }
    idx, err := strconv.Atoi(r.URL.Query().Get("index"))
    if err != nil || idx < 0 { writeJSON(w, 400, map[string]any{"error": "invalid index"}); return }

    site, identifyErrors, err := newSite(raw, r.URL.Query().Get("language"))
    if err != nil { writeJSON(w, 400, map[string]any{"error": err.Error(), "identifyErrors": identifyErrors}); return }
    chaps, fetchErrors := site.FetchChapters()
    if idx >= len(chaps) { writeJSON(w, 404, map[string]any{"error": "chapter index not found"}); return }

    c, err := site.FetchChapter(chaps[idx])
    if err != nil { writeJSON(w, 502, map[string]any{"error": "failed to resolve chapter", "details": err.Error()}); return }
    pages := make([]page, 0, len(c.Pages))
    for _, p := range c.Pages { pages = append(pages, page{Number: p.Number, URL: p.URL}) }

    writeJSON(w, 200, map[string]any{
        "source": sourceName(site), "url": raw, "index": idx,
        "number": c.Number, "title": c.GetTitle(), "language": c.Language,
        "pages": pages, "identifyErrors": identifyErrors, "fetchErrors": errorsToStrings(fetchErrors),
    })
}

func errorsToStrings(errs []error) []string {
    out := make([]string, 0, len(errs))
    for _, e := range errs { if e != nil { out = append(out, e.Error()) } }
    return out
}

func searchMangaDex(q string) ([]result, error) {
    endpoint := "https://api.mangadex.org/manga?title=" + url.QueryEscape(q) + "&limit=10&includes[]=cover_art"
    req, _ := http.NewRequest(http.MethodGet, endpoint, nil)
    req.Header.Set("Accept", "application/json")
    res, err := http.DefaultClient.Do(req); if err != nil { return nil, err }; defer res.Body.Close()
    if res.StatusCode < 200 || res.StatusCode >= 300 { return nil, fmt.Errorf("MangaDex returned %s", res.Status) }
    var body struct { Data []struct { ID string `json:"id"`; Attributes struct { Title map[string]string `json:"title"` } `json:"attributes"` } `json:"data"` }
    if err := json.NewDecoder(res.Body).Decode(&body); err != nil { return nil, err }
    out := make([]result, 0, len(body.Data))
    for _, m := range body.Data {
        title := m.Attributes.Title["en"]
        if title == "" { for _, t := range m.Attributes.Title { title = t; break } }
        u := "https://mangadex.org/title/" + m.ID
        out = append(out, result{Source:"mangadex", Title:title, URL:u, Access:"/source?url=" + url.QueryEscape(u)})
    }
    return out, nil
}

func searchComick(q string) ([]result, error) {
    endpoint := "https://api.comick.dev/v1.0/search/?q=" + url.QueryEscape(q) + "&page=1&limit=10&t=false&showall=false"
    req, _ := http.NewRequest(http.MethodGet, endpoint, nil)
    req.Header.Set("Accept", "application/json")
    res, err := http.DefaultClient.Do(req); if err != nil { return nil, err }; defer res.Body.Close()
    if res.StatusCode < 200 || res.StatusCode >= 300 { return nil, fmt.Errorf("Comick returned %s", res.Status) }
    var rows []struct { HID string `json:"hid"`; Slug string `json:"slug"`; Title string `json:"title"` }
    if err := json.NewDecoder(res.Body).Decode(&rows); err != nil { return nil, err }
    out := make([]result, 0, len(rows))
    for _, m := range rows {
        id := m.HID; if id == "" { id = m.Slug }
        u := "https://comick.dev/comic/" + m.Slug
        out = append(out, result{Source:"comick", Title:m.Title, URL:u, Access:"/source?url=" + url.QueryEscape(u) + "&id=" + url.QueryEscape(id)})
    }
    return out, nil
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
    q := strings.TrimSpace(r.URL.Query().Get("q")); if q == "" { writeJSON(w, 400, map[string]any{"error":"missing q"}); return }
    type sr struct { items []result; err error }
    ch := make(chan sr, 2)
    go func(){ x,e:=searchMangaDex(q); ch<-sr{x,e} }()
    go func(){ x,e:=searchComick(q); ch<-sr{x,e} }()
    var results []result; var errs []string
    for i:=0;i<2;i++ { x:=<-ch; if x.err!=nil { errs=append(errs,x.err.Error()) } else { results=append(results,x.items...) } }
    writeJSON(w, 200, map[string]any{"query":q,"results":results,"errors":errs})
}

func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request){ writeJSON(w,200,map[string]any{"ok":true,"service":"manga-multi-source-engine","engine":"elboletaire/manga-downloader@v1.7.0"}) })
    mux.HandleFunc("/search", handleSearch)
    mux.HandleFunc("/source", handleSource)
    mux.HandleFunc("/chapter", handleChapter)
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request){ writeJSON(w,200,map[string]any{"ok":true,"endpoints":[]string{"/search?q=...","/source?url=...","/chapter?url=...&index=0"}}) })
    port := os.Getenv("PORT"); if port=="" { port="8080" }
    srv := &http.Server{Addr:":"+port, Handler:mux}
    log.Printf("manga multi-source API listening on :%s", port)
    log.Fatal(srv.ListenAndServe())
}
