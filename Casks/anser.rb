cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.45"
  sha256 arm:   "a422c8126270e341e72d28a87261812d3128a890d80bf60bb4f1d0dd49e634f1",
         intel: "8b5626ede67aaa3b10cbd68c75f24b5366a1bedea9d6c573ecd6fc8a4312dd67"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
