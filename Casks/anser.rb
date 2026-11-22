cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.44"
  sha256 arm:   "d6f64dda39f53e38394f18921350b793f4a9a048195b7e4c2f0817ac452b9f22",
         intel: "6649c1b68aaa6dae7592f8489af020c5eb79700a5e71fe636ec64c895834c30d"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
